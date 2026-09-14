# R28 Phase 3 契约 B · coder 交付

日期：2026-09-14。实现与当前自动化验证完成，交 Hub 独立复核及真实浏览器验收。基线 859，本轮新增 18 项测试，当前 **877/877**；未提交、推送或部署。

## 实现与行为

`MaterialsPanel.tsx` 是与 DiscussionStrip/SynthesisPanel 同层的独立「参考素材」折叠区，以 tree_id 为 key。首次展开读取素材；折叠后再展开保持当前列表，动作成功后按返回 id 更新本地列表，无轮询或全局 store 接线。切换同树节点保留面板状态，切换树卸载旧面板并忽略迟到响应；加载失败提供显式重试。

- 使用原生 textarea 与可选标题输入框，不接 Markdown 编辑器或渲染器。原文按输入提交，实时计数与服务端相同，使用 JS 字符串长度；全空白或超过 10,000 字符禁保存，正好 10,000 可保存。无 maxLength 静默截断。创建时空标题省略，由服务端推导。
- 列表显示返回标题、字符数及启停状态；「已停用·不进 AI 上下文」说明停用语义，启用素材标注为讨论参考。切换启停只 PATCH enabled，成功后更新该行。
- 编辑带入完整原文和原标题，通过同一 id PATCH 原地更新；取消编辑不发请求。保存期间禁用输入与其他操作，避免重复提交或在保存中覆盖新草稿。
- 删除复用既有 ConfirmDialog，取消不发 DELETE，确认后才删除；失败保留对话框与原行并展示服务器错误，可重试。删除当前编辑项会清空编辑器。
- 容量显示「已用 X/20 条 · Y/50,000 字」，包含停用行；达到任一容量显示可编辑/删除提示。满载不额外禁掉所有提交，保留服务端同内容 POST 的幂等语义。返回既有 id 时只更新同一行，不重复计数、不重新启用，并提示保持既有状态。
- 400 MATERIAL_TOO_LARGE/TREE_MATERIAL_LIMIT 与 409 MATERIAL_ALREADY_EXISTS 的 `error` 原文在面板展示，失败保留草稿；删除错误在确认框内展示。

`api/client.ts` 新增四方法：`listMaterials(treeId)`、`createMaterial(treeId,{content,title?})`、`updateMaterial(id,{content?,title?,enabled?})`、`deleteMaterial(id)`，复用既有 json 请求助手。`api/types.ts` 新增 Material snake_case 类型，enabled 为 0|1，PATCH 接受 boolean/0/1；保留 201/幂等 200 响应及 ApiError 的 status/payload。

`MainDoc.tsx` 只增加 import/挂载两行。`Workbench.css` 只追加 26 行 `.material-` 前缀样式，复用既有颜色、间距、表单样式与换行布局；无新增断点或依赖。api/context.tsx、store、其他组件无需修改。

## 本轮验证证据

以下使用 `PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH`，均 exit 0：

| 命令 | 当前结果 |
| --- | --- |
| web 目录 `pnpm exec vitest run src/api/client.test.ts src/components/MaterialsPanel.test.tsx` | **42/42**：client 29，MaterialsPanel 13 |
| 根目录 `pnpm -r test` | **877/877**：shared 45（9 文件）/server 404（61 文件）/web 428（52 文件） |
| 根目录 `pnpm -r typecheck` | shared/server/web 三包通过 |
| 根目录 `pnpm build` | Vite 312 modules，构建通过；仍有 >500 kB chunk 提示，当前主入口 1094.46 kB / gzip 387.59 kB |
| `git diff --check` | 无错误 |

新增 18 项：client 5，组件 13。覆盖四方法路径/方法/body/响应形状、同内容 200、400/409 原文；首次加载/本地列表更新、原文计数和 10k 边界、启停及禁用容量、编辑保存/取消、删除确认/取消/错误、20 条和 50k 满载、幂等行去重、错误时保留草稿、加载重试及切树迟到响应隔离。

以契约 B 启动时 272 个 `packages/*/src/**` 文件 SHA-256 为基线，当前差异：

- 修改恰为 client.ts、client.test.ts、types.ts、MainDoc.tsx、Workbench.css 五个授权文件。
- 新增恰为 MaterialsPanel.tsx、MaterialsPanel.test.tsx。
- CSS 前 **107371 字节** SHA-256 与基线一致，后面恰追加 26 行。
- MainDoc 去除新增 import 与挂载两行后 SHA-256 与基线一致。
- server/shared 全部文件（含契约 A 尚未提交改动）、DiscussionStrip/SynthesisPanel 等其他组件及 store 完全不变。既有报告未改，本轮仅写本报告。

## 边界与剩余验收

草稿与列表状态仅在组件内存，不新增持久化；切树会关闭当前编辑状态。面板不监测其他浏览器的并发修改，提交容量和内容冲突以服务端响应为准。启停影响之后发起的讨论/开放问题/回顾请求，已有生成结果继续保留。

Hub 按契约执行 1980px / 1440px 真实浏览器与讨论引用素材的闭环验收，本报告不宣称已完成该验收。coder 本轮未调用真实写 API、未操作真实 DB/vault、未重启或终止 :4000/:5173。无阻塞项。
