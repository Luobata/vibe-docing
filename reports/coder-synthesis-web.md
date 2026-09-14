# R28 Phase 2 Contract B v2 · coder 交付

日期：2026-09-14。实现与本轮自动化验证完成，交 Hub 独立复核及真实浏览器验收；coder 不作最终验收决定。契约前置基线 818，本轮增加 22 项测试，当前全量 840。

## 实现与路径

- `packages/web/src/components/SynthesisPanel.tsx`：一个树级折叠入口，包含成文、开放问题、断点回顾、决策日志四区块。展开按需读取数据；成文 SSE 展示节点进度、综合阶段、错误与终态。409 显示既有任务；重进面板展示 DB 保存进度并提供手动刷新；停止调用取消端点并 abort 自己的请求，卸载亦 abort。取消请求到达前已完成的任务保留完成状态。
- 成文正文直接复用 `renderMarkdown` 与 `useCodeEnhancements`；不额外生成章节标题。正文脚注标记及文末列表按既有 Markdown 管线展示，另有来源列表按钮，通过既有 `setMain` 导航并展示路径。历史选择与重跑后 diff 复用服务端 `DiffLine[]` 和 `LineDiffView`，客户端不计算 diff。
- 分享支持读取、创建、复制与撤销，URL 仅存组件内存，也提供只读链接输入框。按 v2 裁决接受 GET/幂等 POST 重复返回同一链接，POST 发 `{}`。开放问题支持抽取、解决、重开与再次抽取，去重交服务端；回顾按钮有耗时状态及缓存结果标记；verdict 设置/清除通过既有 `upsertNode` 更新，并重新读取含合并事件的决策日志。
- `packages/web/src/api/client.ts`、`types.ts`：管理端点方法及响应类型；SSE 支持 UTF-8 分块、CRLF、ping 忽略、done/error/cancelled 终态与 abort/空闲清理。保持既有 discussion/answer 流实现不变，无重连。
- `packages/web/src/components/MainDoc.tsx`：仅 import 与挂载两行。`Workbench.css`：末尾追加 32 行，选择器以 `.synthesis-` 为前缀，使用既有 token；没有新增断点、依赖或 store 字段。
- 聚焦测试路径：`packages/web/src/api/client.test.ts`（新增 10 项），`packages/web/src/components/SynthesisPanel.test.tsx`（新增 12 项）。

## 本轮验证证据

以下命令使用 `PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH`，从项目根目录运行，均 exit 0：

| 命令 | 当前结果 |
| --- | --- |
| `pnpm -r test` | shared 45/45（9 文件），server 385/385（60 文件），web 410/410（51 文件），合计 **840/840** |
| `pnpm -r typecheck` | shared、server、web 三包通过 |
| `pnpm build` | Vite 构建通过，311 modules；存在 >500 kB chunk 提示，主入口 1089.14 kB / gzip 385.79 kB |
| `git diff --check` | 无错误 |

本次全量测试包含最后增加的「取消与完成竞态」用例。此前聚焦执行的 client 24/24、组件 11/11 亦已通过；最终组件数量为 12，由上述全量运行验证。覆盖管理端点路径/方法/body/响应形状，SSE 终态与清理，六章各一次、血缘导航、409、重进刷新、重跑 diff、分享创建/复制/撤销、开放问题 loading/解决/重开、回顾 loading/缓存、verdict 设置/清除、取消/卸载/错误重试。

以契约 B 开始时捕获的 267 个 `packages/*/src/**` 文件 SHA-256 为基线，本轮核对得到：

- 修改恰为 client.ts、client.test.ts、types.ts、MainDoc.tsx、Workbench.css；新增恰为 SynthesisPanel.tsx、SynthesisPanel.test.tsx。
- CSS 前 104084 字节 SHA-256 与基线一致，证实仅追加。
- MainDoc 去掉新增 import 和挂载两行后 SHA-256 与基线一致，证实既有代码零改。
- server/shared 所有基线文件及此前契约 A 的未提交变更均未改变；没有新增这些目录的文件。api/context.tsx、store、其他组件也未改。

## 裁决与剩余边界

已关闭 blocker `20260913171858108-coder-bb2be43d`：旧契约「分享链接仅一次返回」与既有代码不符，Hub 已将契约更新为 v2，按稳定可重复获取链接实现。

按契约保留手动刷新；已有运行重进后不续流、不轮询，也不自动重新生成。浏览器剪贴板能力不可用时会显示请求错误，用户仍可从只读输入框手动复制。分享链接没有额外持久化。

真实浏览器 1980px / 1440px 两档及真实树全链路由 Hub 验收，本报告不宣称已执行。coder 本轮未操作真实 DB/vault，未重启或终止 :4000/:5173，未 commit/push/deploy。真实 LLM 的耗时、内容质量沿用已验收服务端行为，本轮证据为客户端及组件自动化和生产构建。
