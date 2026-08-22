# Vibe Docing 可编辑文档技术方案（第一阶段）

- 日期：2026-08-12
- 状态：Superseded（保留为早期 Tiptap / ProseMirror 方案记录）
- 范围：让当前文档成为可直接编辑、自动保存的本地笔记正文
- 非范围：文档关联、双链、反向链接、知识图谱、桌面壳
- 布局验收：1980px、1440px

## 0. 2026-08-13 实现基线修正

当前实现没有继续采用下文的“正文仍存 `ai_response`、后续再迁移”方案。已经落地的存储边界是：

```text
ai_response       = 模型原始输出证据，只由生成流程写入
document_content  = 用户可编辑正文，Markdown / Canvas / 旧 ProseMirror 内容的统一事实源
```

- `nodes` 与 `node_versions` 均有独立的 `document_content` 字段；旧数据库升级时只做一次 `ai_response -> document_content` 回填，同时保留原模型输出。
- AI 流式生成会同时建立模型证据和初始正文；之后的手工编辑、Vault 外部同步、版本回退只修改 `document_content`，不得覆盖 `ai_response`。
- 上下文装配、合并、分享和渲染统一通过 `documentContentOf(...)` 读取正文；它只为旧数据提供 `ai_response` 兼容回退。
- 当前编辑器基线是 CodeMirror Markdown、JSON Canvas 与本地 Vault 文件同步，不是下文建议的 Tiptap 常驻 ProseMirror 编辑器。

因此，下文第 1～13 节仅保留为历史设计与未来富文本方向参考，不能再作为当前数据契约或“已实现能力”的验收依据。若未来重新引入 ProseMirror/Tiptap，也必须保持“模型证据”和“可编辑正文”物理分离，不能把二者重新合并到一个字段。

## 1. 结论

第一阶段不重做存储，也不先引入 Markdown 文件仓库。继续以 ProseMirror JSON 作为正文的规范存储格式，在前端引入基于 ProseMirror 的常驻编辑器，提供接近 Obsidian Live Preview 的写作体验：直接输入、Markdown 快捷语法、即时排版、自动保存和版本恢复。

编辑器建议采用 Tiptap。原因是当前 `nodes.ai_response` 已经存储 ProseMirror JSON，已有 `visual_ref` 自定义节点和以正文投影为基础的批注能力。采用其他编辑内核会同时引入内容迁移、可视化节点迁移和批注定位迁移。

第一阶段的产品关系调整为：

```text
文档正文 = 用户可直接编辑的一等内容
AI 生成 = 产生或修改正文的一种操作
提问记录 = 正文的生成来源，不再等同于正文
```

数据库字段 `ai_response` 暂时保留以控制改造范围，但新增代码一律通过 `DocumentContent` 领域接口访问，不再向编辑器暴露“AI 回答”命名。验证方向成立后，再单独迁移为 `content_json`。

## 2. 第一阶段边界

### 2.1 必须支持

- 当前主文档默认处于可编辑状态，不需要点击“编辑”按钮。
- 空白文档可以直接开始写作，不需要先向 AI 提问。
- 支持段落、H1～H6、粗体、斜体、删除线、行内代码、代码块、引用、分隔线。
- 支持有序列表、无序列表、任务列表和表格，避免现有 AI 内容进入编辑器后降级。
- 支持普通 URL 链接；`[[文档链接]]` 不在本阶段实现。
- 支持 Markdown 输入快捷语法和粘贴 Markdown。
- 自动保存，有明确的“保存中 / 已保存 / 保存失败 / 内容冲突”状态。
- 编辑操作进入版本历史，并可回退。
- 切换文档、关闭页面和执行 AI 操作前，不丢失尚未保存的内容。
- 编辑后已有选区批注、派生来源锚点保持在正确文本上；原文被删除时明确标记锚点失效。
- AI 生成、分享、上下文装配、纯文本投影继续正确处理新格式正文。

### 2.2 暂不支持

- Markdown 源码模式和分屏预览。
- Wiki Link、块引用、反向链接和关系图谱。
- 多人实时协同与 CRDT。
- 插件系统、主题系统、Canvas。
- 直接打包 Electron/Tauri 客户端；先在当前本地 Web 运行方式中稳定编辑内核。
- 在附件存储完成前，不接受本地图片粘贴并给出“已保存”的误导提示。

## 3. 当前实现与主要缺口

当前已有能力：

- `nodes.ai_response` 保存 ProseMirror JSON。
- `PATCH /api/nodes/:id` 可以更新正文并创建 `edit` 版本。
- `node_versions` 支持版本列表、diff 和回退。
- `DocView` 能将正文投影为纯文本后通过 `markdown-it` 渲染。
- 批注通过规范纯文本偏移量保存。
- AI 流式生成过程中持续把部分正文写入 SQLite。

直接把编辑器放进页面会出现四类问题：

1. 当前 ProseMirror JSON 只是“包含 Markdown 字符串的段落”，还不是标题、列表等语义化节点。
2. 每次自动保存都会追加版本，长时间输入会产生大量无意义版本。
3. 并发请求没有内容修订号，旧的保存响应可能覆盖新的输入。
4. 批注保存的是纯文本偏移量，编辑正文后会发生锚点漂移。

因此本阶段不是简单替换 `DocView`，而是同时建立内容规范、保存协议和锚点更新机制。

## 4. 内容模型

### 4.1 API 领域类型

```ts
interface DocumentContent {
  nodeId: string
  doc: ProseMirrorNode
  revision: number
  schemaVersion: 1
  updatedAt: string
}
```

前端编辑器、自动保存和只读渲染只使用该类型。`NodeRow.ai_response` 的兼容映射集中放在 API/Repo 层，避免旧字段继续扩散。

### 4.2 ProseMirror Schema v1

正文允许的节点：

- `doc`
- `paragraph`
- `heading`
- `text`
- `hard_break`
- `horizontal_rule`
- `blockquote`
- `bullet_list`、`ordered_list`、`list_item`
- `task_list`、`task_item`
- `code_block`
- `table`、`table_row`、`table_header`、`table_cell`
- `visual_ref`：保留现有可视化产物的原子节点

正文允许的 mark：

- `bold`
- `italic`
- `strike`
- `code`
- `link`

文档必须经过白名单校验后才能写入数据库。服务端限制嵌套深度、节点数量和序列化体积；附件二进制不得内嵌进 JSON。

### 4.3 数据库调整

在 `nodes` 增加：

```sql
content_revision INTEGER NOT NULL DEFAULT 0,
content_schema_version INTEGER NOT NULL DEFAULT 0,
content_updated_at TEXT
```

- `content_revision`：每次成功保存递增，用于乐观并发控制。
- `content_schema_version = 0`：现有“Markdown 文本段落”格式。
- `content_schema_version = 1`：语义化 ProseMirror 文档。
- `content_updated_at`：只表示正文修改时间，避免复用会被路由、删除状态等操作更新的 `updated_at`。

在 `node_versions` 增加：

```sql
edit_session_id TEXT,
content_revision INTEGER,
updated_at TEXT
```

同一节点、同一 `edit_session_id` 的自动保存合并为一条编辑版本。聚焦编辑器时创建 session，失焦或切换文档后结束。这样既保留崩溃恢复能力，也不会每输入几个字就产生一个版本。

在 `annotations` 增加：

```sql
anchor_status TEXT NOT NULL DEFAULT 'valid'
```

可选值第一阶段只有 `valid` 和 `orphaned`。原文范围被完整删除时保留 `quoted_text`，清空偏移量并标记为 `orphaned`，不能静默关联到错误位置。

## 5. Markdown 与旧数据兼容

建立一套共享内容适配层：

```text
parseMarkdownToDoc(markdown) -> ProseMirror JSON
docToMarkdown(doc)           -> Markdown
docToPlainText(doc)          -> 规范纯文本
legacyDocToSchemaV1(doc)     -> ProseMirror JSON v1
```

要求：

- 标题、列表、任务项、代码块、表格、普通链接可稳定往返。
- `visual_ref` 序列化为受控扩展语法，导入时可以还原；外部 Markdown 阅读器至少能看到 alt text。
- AI 上下文和分享导出使用 `docToMarkdown`，不能继续依赖简单拼接文本节点。
- 批注与选区统一使用 `docToPlainText`，浏览器和服务端必须共享同一投影规则。

旧数据采用惰性迁移：

1. 读取 `schemaVersion = 0` 内容。
2. 将旧 ProseMirror 文档投影为原始 Markdown。
3. 解析成 Schema v1，仅在内存中展示。
4. 用户第一次修改或明确执行迁移时，才以 Schema v1 写回。

这样不会在启用编辑器时批量改写现有长期数据库。上线前必须使用 SQLite backup API 备份 `vibe-local.db`，不能只复制正在运行的主文件。

## 6. 保存协议

新增专用接口，旧的节点编辑接口继续服务于兼容逻辑和问题编辑：

```http
PATCH /api/nodes/:id/content
```

请求：

```json
{
  "baseRevision": 12,
  "schemaVersion": 1,
  "doc": { "type": "doc", "content": [] },
  "editSessionId": "session-id",
  "anchors": [
    {
      "id": "annotation-id",
      "from": 20,
      "to": 35,
      "quotedText": "更新后的原文",
      "status": "valid"
    }
  ]
}
```

服务端在一个事务中完成：

1. 校验节点、Schema 和正文大小。
2. 使用 `WHERE id = ? AND content_revision = ?` 更新正文并递增 revision。
3. 更新本次正文包含的批注锚点状态。
4. 按 `editSessionId` 创建或更新一条 `edit` 版本。
5. 返回最新 revision 和保存时间。

revision 不匹配时返回 `409 Conflict`，同时返回服务端 revision。前端不能自动覆盖，提供：

- 重新载入服务端版本；
- 复制本地未保存内容；
- 查看差异后选择保留版本。

即使产品定位为单机，也需要 revision：开发页面、多窗口和迟到的网络响应都会造成保存乱序，不需要为此引入 CRDT。

## 7. 前端架构

新增模块建议：

```text
packages/web/src/editor/
├── DocumentEditor.tsx
├── DocumentRenderer.tsx
├── schema.ts
├── markdown.ts
├── visual-ref-extension.ts
├── annotation-anchor-plugin.ts
├── use-document-autosave.ts
└── save-queue.ts
```

职责：

- `DocumentEditor`：当前主文档的常驻编辑器。
- `DocumentRenderer`：派生卡片、对话历史和分享预览的同 Schema 只读渲染器。
- `use-document-autosave`：dirty 状态、750ms debounce、最大等待时间和错误重试。
- `save-queue`：按 `nodeId` 串行保存，永远只提交当前未确认的最新状态。
- `annotation-anchor-plugin`：将数据库中的规范文本偏移转换为编辑器位置，并随 transaction mapping 移动。

编辑状态机：

```text
clean -> dirty -> saving -> saved -> clean
                   |          |
                   v          v
                 error      conflict
```

保存策略：

- 编辑器更新后 750ms 自动保存。
- 连续输入时设置最大等待时间，避免永远不落盘。
- 文档切换、编辑器失焦、执行 AI 生成/合并/回退前强制 flush。
- 保存请求按节点串行；不使用“取消旧请求”代替顺序控制。
- 只有服务端确认 revision 后才显示“已保存”。
- 切换节点时销毁旧 editor instance，所有异步回调同时校验 `nodeId + revision`，避免跨文档写入。

## 8. 批注与选区稳定性

这是编辑能力的上线门槛，不能后补。

加载正文时：

1. 用统一投影函数把 `anchor_from/to` 转为 ProseMirror position。
2. 在插件状态中维护锚点范围，并以 decoration 展示。
3. 每次编辑 transaction 使用 `transaction.mapping` 更新锚点位置。
4. 保存正文时，将位置重新转换为规范文本偏移，与正文在同一事务保存。

如果一个锚点范围被删除：

- 标记为 `orphaned`；
- 保留原 `quoted_text` 和关联记录；
- UI 显示“原文已修改，无法定位”；
- 不自动猜测新的相似文本位置。

对视觉节点的整图批注仍然通过 `visual_ref` 标识，不参与文本偏移映射。

## 9. 与 AI 生成的协作规则

- 节点处于 `streaming` 时正文只读，用户可停止生成后开始编辑。
- 流式阶段继续以 Markdown 流展示和保存部分结果；生成完成后一次性解析为 Schema v1。
- 发起重新生成、派生、合并、版本回退前先 flush 当前编辑内容。
- 任何会替换现有正文的 AI 操作必须保留操作前版本。
- 上下文装配读取 `docToMarkdown` 结果，保证标题、列表和代码结构不丢失。
- 现有合并结论区域第一阶段保持独立只读，不顺带改变关联和合并语义。

## 10. UI 调整

主文档区域调整为：

```text
文档标题                         已保存
────────────────────────────────────
常驻正文编辑器

AI 提问/继续探索入口
```

- 移除主正文外层“第 1 轮”的强对话心智；历史提问可折叠展示为“生成来源”。
- 空白正文显示写作 placeholder，点击即可输入。
- 工具栏保持轻量，Markdown 快捷键优先；选中文字后显示格式与“笔记/展开”工具条。
- 仅验收项目规定的 1440px 和 1980px 两档视口。

## 11. 实施拆分

### M0：内容内核

- 定义 Schema v1 和 `DocumentContent`。
- 完成 Markdown、纯文本、旧格式适配器及 round-trip 测试。
- 增加数据库幂等迁移。

### M1：常驻编辑器

- 引入 Tiptap 和基础扩展。
- 实现 `DocumentEditor`、只读 renderer、Markdown 快捷语法。
- 支持现有 `visual_ref` 原子节点。

### M2：可靠保存与版本

- 实现 content API、revision 冲突检测、按节点保存队列。
- 实现编辑 session 版本合并。
- 增加保存状态、失败重试和冲突 UI。

### M3：批注与现有流程兼容

- 实现锚点 position 映射和失效状态。
- 接回选区工具条、批注和选区展开。
- 在 AI、合并、回退、切换节点前 flush。

### M4：产品界面收敛

- 主区域从“对话轮次”调整为“文档正文”。
- 生成问题降级为来源信息，AI composer 与正文解耦。
- 完成 1440px、1980px 视觉回归。

### M5：附件子阶段

- 设计本地附件目录和元数据表。
- 支持粘贴/拖入图片、去重、删除与导出。
- 在该阶段完成前，图片粘贴必须明确提示不会保存，不能静默丢失。

### M6：客户端化

- 编辑内核和数据安全验证通过后再选择 Tauri/Electron。
- 桌面壳只负责窗口、文件系统权限、更新和快捷键，不重新实现内容存储。

## 12. 测试与验收

### 单元测试

- Markdown ↔ Schema v1：标题、嵌套列表、任务列表、表格、代码块、链接、`visual_ref`。
- `docToPlainText` 在浏览器和服务端结果一致。
- transaction 后批注偏移正确更新；删除原文后变为 orphaned。
- 保存队列不会让旧响应覆盖新内容。

### API/数据库测试

- 正确 revision 保存成功并递增。
- 过期 revision 返回 409，且不修改正文和批注。
- 正文、批注锚点和编辑版本在同一事务中提交。
- 同一 edit session 多次保存只保留一个可见版本。
- 旧数据库迁移后可读，迁移重复执行无副作用。

### 端到端验收

- 新建空白树后，不询问 AI 也能写正文并自动保存。
- 快速连续输入后刷新页面，内容完整且顺序正确。
- 输入 Markdown 快捷语法后即时呈现对应格式。
- 编辑带批注的段落后批注仍定位正确；删除原文后有明确失效提示。
- 生成中禁止编辑；停止生成后可编辑部分内容。
- 编辑后执行版本回退可以恢复到编辑前状态。
- 切换文档后不会把上一文档的延迟保存写入当前文档。
- 1440px 和 1980px 下正文宽度、工具条、保存状态和 AI composer 均可用。

## 13. 发布门槛

以下条件全部满足后，才认为“可编辑第一阶段”完成：

1. 用户可以从空白正文开始写，不依赖 AI。
2. 刷新、切换文档和异常退出不丢失已确认保存的内容。
3. 版本数量不会随每次按键无限增长。
4. 现有 Markdown、可视化节点和批注不会因进入编辑器而损坏。
5. AI 操作不会静默覆盖尚未保存的人类编辑。
6. 已有数据库完成备份和惰性迁移验证。
