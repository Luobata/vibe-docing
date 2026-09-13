# Round 28 Phase 1 契约二 · 讨论前端交付

日期：2026-09-13。状态：按最新合同完成实现和当前运行验证，待 Hub 真实浏览器验收。

## 交付行为

- 主文档正文下新增可折叠「讨论 (N)」条。默认收起，展开显示历史消息、user/assistant 区分、讨论输入和三个指令。MainDoc 仅新增 import 与带 key/node/onSaved 的挂载，共 2 行；ChatBox 智能路由提问保持原样。
- Enter 发送，Shift+Enter 换行；IME isComposing 与 keyCode=229 不发送。普通讨论不创建节点。生成时显示流式 Markdown、思考/回复状态，ping 更新「思考中 · 连接正常」；停止与文档卸载取消 fetch/reader。
- 「反驳我 / 三视角 / 收敛」直接调用 moves 端点，先显示指令名作为合成用户消息；完成后用服务器 messages 替换。三视角按 step/persona 渲染 chip；历史消息依据服务器固定的 persona 标题恢复 chip，仅在展示时去掉重复标题，原消息内容不改。
- 未完成输出保留在本次界面并标「未完成 · 未保存」，不伪造可沉淀的消息 id。第二步失败显示 step/persona 错误，已保存第一步与第二步已流出的部分均保留且不重复。取消/连接失败后尝试重新读取已落库消息；重读不会把后来新请求的状态覆盖。
- assistant 行内多选，选中后显示「转为子文档 / 追加为小节」。讨论生成及沉淀进行中禁止重发、moves、选择和再次沉淀。child 成功 upsert 新子节点、刷新树并 toast；section 成功 upsert 当前正文并提示可在版本历史回退。成功消息显示「已沉淀 → 子文档/小节」。Canvas/Base 不显示可用的小节追加动作，沿服务端 Markdown 限制禁用。
- section 第一次提交使用当前 node.content_revision；仅遇 409 时 GET 当前节点、upsert 最新正文，再用最新 revision 重试一次。第二次仍 409 则 toast「内容已变化，请重试」并保留选择。没有循环重试，也没有自建正文保存路径。

## 已决边界

1. **纠正动作本期移除**。coder 只读取证：correct-service.ts:76-91 仅支持 source.parent_id，root 被拒绝；前端参数化无法让讨论纠正当前文档。Hub 修改持久合同后明确移除，目标为当前节点/来源为讨论消息的能力转 R28 Phase 2。CorrectiveMergeButton 没有改动，也没有用额外子节点绕过目标限制。
2. **CJK 本期交付检测与固定系统栈，本机不宣称对齐**。当前运行 system_profiler SPFontsDataType -json 未发现 Sarasa Mono SC、Noto Sans Mono CJK SC 或 Osaka-Mono；本机列出的 mono 家族为 .SF NS Mono、Andale Mono、ComicShannsMono Nerd Font（含 Mono/Propo）、Courier New、PT Mono。Hub 据此更新合同：固定 `'Sarasa Mono SC','Noto Sans Mono CJK SC',var(--mono)`；未装时回退原字体，owner 以后安装匹配字体可自动启用。没有安装字体、引入 webfont 或变更依赖。

## 接入点与 API

`api/client.ts` 新增独立讨论流消费函数，原 streamAnswer 主体不改。沿 R25 使用字节活性与 45 秒空闲阈值、每 5 秒检查；ping 和半帧字节都会刷新计时。取消时清理 reader、监听器和 interval；终态 done/error 后结束读取，不等待服务器继续关闭，错误后的后续帧不再落 UI。

| 方法 | 调用与返回 |
| --- | --- |
| listDiscussion | `(nodeId)` → `{ messages }` |
| sendDiscussion | `(nodeId, userInput, handlers, signal?)` → SSE |
| runDiscussionMove | `(nodeId, move, handlers, signal?)` → SSE |
| promoteDiscussion | `(nodeId, {mode, messageIds, baseRevision?})` → `{node, content, messages}` |

handlers 为 onChunk(text, {step?, persona?})、onDone(messages)、onError(message, {messages?, step?, persona?})、可选 onPing/onCancelled。done 不依赖回答端点的 node 字段。HTTP ApiError 保留 JSON payload（包括 currentRevision）；讨论服务端已经开始 SSE 后的错误沿 error 帧呈现。

框线工具 `doc/cjk-diagram.ts` 检测 U+2500–U+257F。接入 `doc/markdown.ts` 原 fence renderer，匹配时仅给 pre 加 is-cjk-diagram，保留 code 语言 class、正文与转义；不匹配的围栏、缩进代码和行内 code 不改。DocView 经 renderAnnotatedHtml、MarkdownEditor 内部 MarkdownPreview 经 renderMarkdown 自动覆盖；无需修改 editor。Shiki 仍只替换 code 内层，外层 class 保留。CSS 对匹配 pre 仅新增 font-family，R8/R10 的 padding、字号、行高不改。

## 当前运行验证

环境：Node 22.21.1，与项目 better-sqlite3 ABI 匹配。

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm exec vitest run src/components/DiscussionStrip.test.tsx src/api/client-discussion.test.ts src/doc/cjk-diagram.test.ts
# 上一条在 packages/web 下执行；下列在仓库根目录执行
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r build
git diff --check
```

- 新增聚焦 **24/24**：DiscussionStrip **13**、client discussion **8**、CJK **3**。
- 全量 **788/788**：shared **43**、server **357**、web **388**，**764 → 788（+24）**；三包 test 均 exit 0。旧测试未删减。
- typecheck 三包 exit 0；build exit 0，309 modules，5.05 秒。既有 React act 与大于 500 kB chunk 提示保留。
- UI 测试使用真实 createApi + fake fetch 的 ReadableStream，覆盖实际 SSE 字节解码接入组件；验证折叠/展开、发送与 Markdown 流式、ping 状态、三个 moves/persona、第二步失败保留、停止/卸载 abort、流式门控、IME、child/section 回写/标记、409 取最新 revision 且最多重试一次。
- client 测试覆盖逐字节 UTF-8 和 CRLF 帧、done 仅带 messages、60 秒静默持续 ping、死流取消/计时器归零、abort 无错误、失败步骤与部分成功消息、错误后丢弃晚到帧、提前 EOF、HTTP 409 payload。
- CJK 测试覆盖框线变体、普通中英文/代码非命中、只标记匹配围栏、保留语言 class 与内容、行内/缩进 code 不变、批注包装后 class 保留。
- 所有新增网络交互均使用 fake fetch；未对真实树执行写入。真实模型与浏览器验收交 Hub，当前没有截图或本机像素对齐 PASS 声明。

## 范围核查

起点/终点 packages/src SHA256 比较仅以下 **9 个授权文件**变化，零删除：

- api/client.ts、api/client-discussion.test.ts
- components/DiscussionStrip.tsx、DiscussionStrip.test.tsx、MainDoc.tsx、Workbench.css
- doc/cjk-diagram.ts、cjk-diagram.test.ts、markdown.ts

另写本报告和共享 reports 同文副本。server/**（含契约一未提交产物）、shared、editor、CorrectiveMergeButton、ChatBox、TreeLauncher/SettingsPanel 全部字节未变。无 package/lock/真实 DB 改动。

机械核验：MainDoc 删掉本轮两行后逐字等于 HEAD；Workbench.css 原文件完整保留为前缀，仅追加 26 行（包含新组件样式与一条 pre 字体规则）。git diff --check 通过。构建产物与 tsbuildinfo 是命令正常产生的忽略文件，未提交。

## Hub 验收要点与余留限制

- 只验 1440px / 1980px：打开真实笔记下方「讨论」，聊一轮，运行三视角，确认 persona/流式与停止；选择回复后分别沉淀 child 和 section，观察树、正文、消息标记与版本提示。
- 阅读含框线围栏：确认 pre.is-cjk-diagram 生效，普通代码/行内 code 不受影响，R8 几何不变。本机未装候选字体，图线像素对齐按 Hub 最新合同不作为本机验收锚。
- 未完成回复只保留在当前组件内，刷新/切换文档不会把未落库部分恢复；已完成的 persona 从服务端恢复。停止不撤销服务端已经保存的步骤。
- 讨论 SSE 沿 R25 的流中活性 watchdog；首次 HTTP 响应之前仍依赖 fetch/用户停止。无独立网络超时或重连策略。非 SSE promote 继续使用服务端既有超时，客户端没有额外取消或重试策略（除 section 的一次 409 重试）。
- 沉淀请求切换文档后，成功仍按返回 node id upsert 树并 toast，不切换用户当前文档。复用原编辑器与保存并发机制，没有修改编辑器内部行为。
- 未提交、推送、部署或重启/终止服务。
