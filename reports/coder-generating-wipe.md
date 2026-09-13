# Round 26 coder · 生成正文清空：Phase A 交付
日期：2026-09-13。状态：v2 合同 A1–A4 完成，待 Hub 验收。当前运行 724 tests、typecheck、build 均通过；原 R25 未提交改动逐文件 SHA256 保持不变。

## 结论

本轮修复了服务端 GET hydration 用旧文件覆盖生成正文的主路径，并补齐文档形状转换、生成态保存防护和版本恢复落盘。生产代码仅 5 文件；另有 5 个测试文件，新增 19 项测试。实现限定为 Hub v2 的 Phase A，生成管线的格式与写盘问题保留给 Phase B。

实现前命中原合同 stop condition：服务端在零客户端保存下可清空 DB 正文。两次 blocker 促成 v2 修订，Hub 撤销“客户端自动保存风暴”假设，授权 vault-service 的最小读取守卫。以下保留本轮取证链。

已发送 blocker：
- `20260913083702453-coder-a3b7517d`：markdown.ts 实际位置、schema 0 兼容冲突。Hub 后续已修订形状优先裁决并增加其写权。
- `20260913083823157-coder-2808a059`：服务端生成 + vault 读取覆写；当时停止实现，Hub v2 补充 A1 授权后恢复。

## 当前运行复现

Node 22.21.1，server workspace 执行 `pnpm exec tsx --eval` 临时探针；使用 openMemoryDb、createDeps 自动隔离临时 vault、createMockProvider。没有访问运行中服务或真实 DB/vault，结束 app.close/db.close 并移除本探针的临时 vault。

路由级探针顺序：
1. `POST /api/trees` 创建隔离笔记（initial revision=1，schema=2，文件为空）。
2. 调用真实 `deps.answer.generate`，mock provider 返回两个 chunk：`generated`、` content`。
3. `GET /api/nodes/:id` 读取刚完成笔记。
4. 读取隔离 vault 文件字节数。全程没有 PATCH content 或其他客户端保存。

实际输出（exit 0）：
```json
{
  "clientSaveRequests": 0,
  "createStatus": 200,
  "initialRevision": 1,
  "done": {
    "revision": 5,
    "schema": 2,
    "body": "{\"content\":[{\"content\":[{\"text\":\"generated content\",\"type\":\"text\"}],\"type\":\"paragraph\"}],\"type\":\"doc\"}"
  },
  "get": {"status": 200, "revision": 6, "body": ""},
  "vaultBytes": 0
}
```

另一个低层探针交叉验证：ensureNodeFile → 3 次 updateGeneration → hydrateNode，revision 1 → 4 → 5，非空 PM JSON → 空串，ai_response 保留非空，客户端保存次数同样 0。

## 行级根因与原假设修正

行号为本次实读、尚未修改版本：

- `server/src/service/answer-service.ts:97-107,132-135`：开始、每个 chunk、完成均 updateGeneration。工具循环兜底 :287-290 同样如此。
- `server/src/repo/node-repo.ts:83-110,119-124`：updateGeneration 把 ProseMirror JSON 写入 document_content；updateContent 保留当前 content_schema_version，并每次正文更新 revision +1。因此原生文件的 schema=2 被保留，且 878 单凭计数不能归因于客户端“保存风暴”。
- `server/src/service/vault-service.ts:130-139`：hydrateNode 无条件把现有磁盘内容送 syncExternalContent；生成路径未同步写该文件。
- `server/src/repo/node-repo.ts:176-199`：DB 正文与磁盘不同时，syncExternalContent 将旧文件覆盖 document_content 并 revision +1。
- `server/src/routes/trees.ts:82,103`：GET 树和 GET 节点均触发 hydration。解释了“只打开笔记就覆写”的可重复机制，无需假设前端发送保存。
- `shared/src/markdown.ts:79`：schemaVersion >=2 原样返回，正好将上述合法 PM JSON 当 Markdown。:82 非 doc 返回原文、:84-85 parse 失败返回原文也是事实，但空 doc 合法 JSON 的现场并不依赖 parse 失败。Hub 已裁决形状优先转换并保留 schema 0 原生 Markdown。
- `web/src/editor/MarkdownEditor.tsx:153-194`：markChanged/saveLatest/flush 确实无 streaming guard，属于应补防线。:198 空依赖 imperative handle 保留初始 flush 闭包；实现时守卫要读取当前状态，不能仅闭包取初始 node。
- `MarkdownEditor.tsx:200-207` 的 reload 同时设置 latestRef 和 lastSavedRef，状态为 clean。:354 editable={!readonly} 已禁正文编辑，并非只有工具栏禁用。
- 安装的 `@uiw/react-codemirror/src/useCodeMirror.ts:53-56,185-190` 给受控 value 更新打 ExternalChange，监听器跳过这类 onChange。因此尚无证据证明 setSource 本身触发了自动保存风暴；不能把守卫缺失当成已确认事故主因。
- `server/src/routes/versions.ts:54-69`：revert 只改 DB+snapshot；vault/hash 缺失属实。既有 vault.writeNode(:142-146) 可复用。但历史版本无 content_schema_version，恢复时还应使 DB 正文、格式标签和落盘内容一致，避免下一次读取又改变正文/版本。

## 标签与编辑入口核查

`TagChips.tsx:15-20,68-70` 仅取最新 node.status==='streaming' 且 tags 为空显示“标签生成中”，不是独立标签任务状态，也不只由 done 驱动。MainDoc.tsx:358-371、SubdocTabs.tsx:230-240 的 done/error 分支都会更新 node 至终态；取消经 generationTaskRegistry.settle 触发注册的 onCancelled。R25 watchdog 走 error，活跃流的占位会自然退出。

后续候选：刷新后仅加载到历史 streaming 节点、没有活跃 streamAnswer/watchdog 的场景，占位仍可能常驻；异步 autoTagNode 不等于标签占位本身。本轮未扩改。

CodeMirror 的 editable=false 是 UI 输入限制；程序化 view.dispatch 不等于用户输入。新增 jsdom 组件测试使用真实 CodeMirror view.dispatch 确认该入口现不标 dirty、不保存；生成结束仍保持焦点时能够重载完成正文并保存真实新编辑。未做真实 IME/粘贴复现，也未修改这些入口或 CanvasEditor。

## 最终实现与验证

| 项目 | 生产路径（修改后行号） | 验证 |
| --- | --- | --- |
| A1 | server/src/service/vault-service.ts:130–144 | 已有文件只有 hash 不同且 mtime 晚于 content_updated_at 才同步；hash 复用原 hash()，node-repo 无需改动 |
| A2 | shared/src/markdown.ts:77–90；prosemirror.ts:12–19,86–89 | schema 0/1/2/99 空 doc 与有内容 doc 均按形状转换；识别到 doc 后渲染失败返回空；非 JSON / 非 doc 原样保留 |
| A3 | web/src/editor/MarkdownEditor.tsx:150–221 | 最新 streamingRef 守卫 markChanged/saveLatest/flush；等待旧请求后复检；旧请求在生成期返回不覆盖 UI；清理防抖并保证完成后聚焦重载 |
| A4 | server/src/routes/versions.ts:68–73 | DB revert 事务后复用 vault.writeNode 写文件与 hash，Markdown 走形状转换，Canvas/Base 原样 |

prosemirror 的输入实际混合旧文档 JSON 与原生 Markdown：调用方包含上下文、版本 diff、annotations；既有 visual-artifact.test.ts 明确断言普通文本直通。依 Hub v2 形状优先原则，仅 doc 走结构投影，非 doc JSON 也作为原生笔记文本保留（修复之前会被无声吞空）；无法投影的已识别 doc 返回 []。没有添加第二份 schema 校验器、digest 或写盘实现。

本次命令均在 Node 22.21.1 下执行（当前机器默认 Node 25 与既有 better-sqlite3 ABI 不兼容）：

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r build
git diff --check
```

- 全量测试：shared **43** / server **317** / web **364**，总计 **724/724**；合同基线 705，新增 19，无旧断言删减。
- 类型检查：三个包均 exit 0。
- 构建：exit 0，307 modules，1.71 秒；现有 >500 kB chunk 提示保留。
- 聚焦测试：markdown.test + prosemirror.test **11**，vault-service.test + versions.test **12**，DocumentEditor.test **19**，合计 **42/42**。
- 修改前先运行共享/服务端新增测试，**12 项按预期失败**：其中核心 GET 复现从 revision 5/非空变成 revision 6/空串，其他涵盖旧/同时间文件覆写、schema 2/99 JSON 泄漏、版本恢复文件仍空。修改后这些测试全部通过。
- 反转验收锚已固化为 vault-service.test 的真实路由+answer.generate 测试：创建空文件、两块生成、把未变更空文件 mtime 刻意调到 DB 之后，两次 GET 均保持正文与 revision；文件仍空，明确没有冒充 Phase B 写盘已修。
- 外部文件测试覆盖 DB 时间前 1 秒、同秒、后 1 秒；仅后 1 秒且 hash 不同同步；第二次读取不增 revision。
- revert 覆盖旧 PM 文档、原生 Markdown、Canvas、Base，断言文件全文、SHA256、响应 node 与 DB 相同，并断言后续 GET 不再改恢复内容。
- 编辑器锁覆盖防抖、显式 flush、beforeunload、visibilitychange、卸载、完成后编辑恢复和等待旧保存期间开始生成；测试使用真实 CodeMirror，不是字符串源码断言。
- 本轮起点 packages 全文件哈希对比：仅白名单内 10 个源码/测试文件变化，零删除，R25 的 answer.ts / answer.test.ts / client.ts / client-stream.test.ts 全部字节不变。另写本报告及共享 reports 同文副本。

## 保留边界与风险

1. **Phase B 尚未修**：updateGeneration 仍写 PM JSON 并保留既有 schema；生成完成并不会同步写 vault。A1 保住 DB，A2 容忍显示错配，不代表磁盘内容已是最新生成结果。真实 owner 数据未代写或恢复；没有重启/杀服务，因此没有宣称运行中服务已加载本轮代码。
2. **合同要求报告的其他覆盖入口**：vault-service.ts:108–119 的 ensureNodeFile(existing 分支)仍直接 syncExternalContent；hydrateNode:131 在缺少 file_path 或 vault_root 时会走该分支。正常已建立文件元数据的笔记走 A1 守卫；该元数据缺失场景未扩修。首次创建新文件的 ensureNodeFile:121–126 仍有格式转换同步，属于初始化行为。sync() 对既有笔记通过 hydrateNode，受 A1 守卫保护。
3. **外部修改裁决的边界**：相同/更旧 mtime 的外部内容即便 hash 不同也不会覆盖 DB，符合 v2 明确的严格时间规则；保留时间戳的复制工具或文件系统时间粒度可能因此不被导入。缺少 DB 内容时间时使用 Unix epoch 作为初始比较点。
4. **revert 按合同在 DB 事务后落盘**：文件系统异常会返回错误，但已经追加的 DB 版本无法与文件原子回滚。成功恢复的读后稳定性已测试。历史快照缺少 schema 字段，本轮保留其原 DB 表示，通过 A2 转换落盘；格式标签统一归 Phase B。
5. **格式识别取舍**：原生文本如果本身恰好是合法 type=doc JSON，会按编辑器文档解释，这是 Hub 明确裁决；非 JSON 包括截断 JSON 仍按原生文本保留，没有扩大成任意 JSON 清洗器。
6. 保存门控阻止生成期间新请求；无法撤回生成开始前已发出的请求。其生成期间返回结果不会更新旧节点 UI。真实 IME/粘贴以及生产浏览器数据回归未执行；相关入口只报告，不改。
7. 标签占位结论见上节；刷新后历史 streaming 无活跃 watchdog 是后续候选。

没有提交、推送、部署，没有改真实 DB/vault。最终验收与 Phase B 优先级交由 Hub。
