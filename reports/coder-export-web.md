# R28 Phase 4 v2 · coder 交付

日期：2026-09-14。实现与本轮自动化验证完成，交 Hub 独立复核及真实浏览器验收。基线 b385033 / 877 tests，本轮新增 13 项，当前 **890/890**。未提交、推送或部署。

## 结果与路径

- `packages/web/src/api/download.ts`：共用文件名清洗与 Blob 下载机制。文件名按契约替换反斜线、正斜线、双引号、CR/LF 为下划线，截取 100 字符，空值 fallback `document`，加 `.md`。Blob MIME 为 `text/markdown;charset=utf-8`，不加 BOM；临时 a[download] 点击后移除，下一轮事件循环 revoke object URL。
- `downloadNodeMarkdown(node, treeTitle)` 只读当前客户端节点快照，经 shared 的 `documentContentOf → legacyDocumentToMarkdown → normalizeMarkdown` 生成 Markdown。节点标题用既有 `prosemirrorToPlainText` 取首行，空标题 fallback 树标题；没有第二份转换或 normalize 实现。
- `Workbench.tsx` **+4/-0 行**：import、既有 generation task 读取及 SharePanel 同排 quiet-button。无当前节点、节点 streaming 或当前节点 task streaming 时禁用；点击下载当前主文档节点。
- `SynthesisPanel.tsx` **+3/-0 行**：import、树标题读取及浏览区按钮。直接下载选中记录的 `contentMd` 原文（包括六章节与原生 `[^n]:` 定义）；文件名为树标题（fallback 节点标题）加「 · 成文」。选中记录未 done、无正文或面板正在处理操作时禁用。列表已含 contentMd，无需增加 API 或创建分享。
- `download.test.tsx` 包含工具与组件测试，集中在契约授权的「对应 test」路径；既有 Workbench/SynthesisPanel 测试文件未改。CSS **零改动**，复用 quiet-button 与 synthesis-actions。

下载不触发编辑器保存或 vault 同步，内容取当前节点快照；草稿保存行为保持现有逻辑。成文使用列表中已有的选中版本，不重新生成。没有网络下载端点或共享链接依赖。

## v2 裁决与证据

blocker `20260914071845871-coder-9b05e817` 已关闭：原契约「与 share .md 逐字节同链」与代码不符，Hub 独立核实后更新 durable 契约 v2，以 Markdown 保真为准。

本轮只读隔离探针（server 目录 `pnpm exec tsx -e`，Node 22）构造 schema=1 PM 文档，含 level=2 heading 与 bold paragraph：

- 指定下载链：`## Heading\n\n**Bold**`。
- 实际 share `.md` 回答正文：`Heading\nBold`。
- share-renderer.ts:82-94 实际调用 `prosemirrorToRenderRuns` 纯文本/visual 投影；synthesis share 还会将脚注定义改为列表。下载按 v2 保留 Markdown 格式与原始脚注定义，不改既有分享行为。

该 PM heading+bold 场景已入测试，spy 明确断言三个 shared 导出各调用一次，且下载没有修改原节点。

## 本轮验证

以下均使用 `PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH`，exit 0：

| 命令 | 当前结果 |
| --- | --- |
| web 目录 `pnpm exec vitest run src/api/download.test.tsx` | **13/13** |
| 根目录 `pnpm -r test` | **890/890**：shared 45（9 文件）/server 404（61 文件）/web 441（53 文件） |
| 根目录 `pnpm -r typecheck` | shared/server/web 三包通过 |
| 根目录 `pnpm build` | Vite 313 modules，构建通过；保留 >500 kB chunk 提示，主入口 1095.35 kB / gzip 387.90 kB |
| `git diff --check` | 无错误 |

覆盖文件名清洗/长度/fallback、Blob MIME/链接触发/URL 回收、UTF-8 原文（围栏/表格/脚注）一致、shared 转换链 spy、PM heading/bold 保真、节点只读、两组件按钮点击及 main streaming/task streaming、synthesis queued/running、无节点禁用。

274 个 `packages/*/src/**` 文件 SHA-256 基线核对：恰修改 Workbench.tsx/SynthesisPanel.tsx，恰新增 download.ts/download.test.tsx。server/shared、MainDoc、MarkdownEditor、SharePanel、store、client.ts、Workbench.css、package.json/lock 均未改。两个组件新增行数 4/3，分别低于契约 6/10 上限。

## 范围外发现与剩余验收

首轮真实 Workbench 组件渲染观察到既有 React 重复 key 警告：MainDoc 同层 SynthesisPanel 与 MaterialsPanel 均 `key={node.tree_id}`。MainDoc 本轮 SHA 与基线一致，属于既存问题；已通过 progress `20260914072408035-coder-02ce907c` 报 Hub，未越权修复。下载的 Workbench 测试随后隔离无关 MainDoc 子树，仍渲染真实 Workbench 并验证头部按钮与 store/task 禁用状态；全量运行包含所有既有组件测试。

Hub 按契约执行 1980px/1440px 真实浏览器下载、文件落地后 grep、Typora/飞书内容检查，本报告不宣称已完成。coder 本轮只执行隔离输入与自动化测试，未操作真实 DB/vault、未重启或终止 :4000/:5173。当前下载任务无阻塞项。

## v3 追加交付：重复 key 功能性回归修复

2026-09-14 15:43–15:45（Asia/Shanghai）。本节基于 Hub durable 契约 v3，工作基线为 v2 下载功能完成后的 890 tests；前文记录 v2 当时范围与证据，本节更新 MainDoc 问题的处理状态。

根因独立确认：MainDoc 同级 SynthesisPanel / MaterialsPanel 共用树 ID 作为 key。新增真实 MainDoc 回归用例在未修复版本首次切换到子节点并完成异步详情加载后，`.synthesis-panel` 实际 **5 个**，期望 1，测试 exit 1，并产生 React duplicate key 警告。该用例未 mock 两个面板，确认问题落在真实组件对账链路。

生产修复恰为 `MainDoc.tsx:988–989` 两行；保留树级生命周期，仅区分组件身份：

```diff
-        <SynthesisPanel key={node.tree_id} node={node} />
-        <MaterialsPanel key={node.tree_id} treeId={node.tree_id} />
+        <SynthesisPanel key={`synthesis-${node.tree_id}`} node={node} />
+        <MaterialsPanel key={`materials-${node.tree_id}`} treeId={node.tree_id} />
```

选择增加一条低成本回归：复用既有 RTL、useWorkbench store 和 API mock 模式，追加在白名单内 `download.test.tsx`，通过 `vi.importActual` 加载真实 MainDoc；原 Workbench 下载测试的隔离保持不变。用例四次切换根/子节点，每次断言成文与材料面板各 1 个，随后点击成文 toggle，验证展开、加载完成、收起均可操作。没有新增 mock 框架、依赖或生产逻辑。

以下均为 v3 当前运行证据，Node 22.21.1（PATH 设置同前文）：

| 命令 | 结果 |
| --- | --- |
| web 目录 `pnpm exec vitest run src/api/download.test.tsx -t 'keeps one operable synthesis panel'`（修复前） | **预期失败**：1 failed / 13 skipped，实际面板 5，exit 1 |
| web 目录 `pnpm exec vitest run src/api/download.test.tsx`（修复后） | **14/14**，exit 0，无该重复 key 警告 |
| 根目录 `pnpm -r test` | **891/891**：shared 45（9 文件）/server 404（61 文件）/web 442（53 文件），exit 0 |
| 根目录 `pnpm -r typecheck` | shared/server/web 三包通过，exit 0 |
| 根目录 `pnpm build` | 313 modules，1.86s，exit 0；既有 >500 kB chunk 提示仍在，主入口 1095.38 kB / gzip 387.93 kB |
| `git diff --check` | 无错误 |

v3 开始时 276 个 `packages/*/src/**` 文件 SHA-256 与修复后对比：恰修改 `MainDoc.tsx`、`download.test.tsx`，无新增或删除源码。相对 b385033 的三个已跟踪生产文件 diff 为 MainDoc +2/-2、Workbench +4/-0、SynthesisPanel +3/-0；v2 下载工具未改。server/shared、CSS、store、编辑器、分享、API client 与依赖声明保持不变。

全量测试仍有既有组件的 act 包裹警告，全部通过；本次聚焦用例无该警告。没有操作真实 DB/vault，没有重启、终止 :4000/:5173，也未提交或推送。Hub 仍需按 v3 契约执行真实浏览器 reload 后面板恰 1 及成文下载验收；本节不把 jsdom 回归等同于浏览器验收。若 Hub 实测仍出现多个面板，按停止条件回报 blocker，不继续猜测性修改。
