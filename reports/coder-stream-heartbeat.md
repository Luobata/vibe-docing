# Round 25 · coder：生成流心跳与僵尸流收尾

2026-09-13，依据共享状态 contracts/coder.md 的 Round 25 契约。实现及代码验证完成，最终验收归 Hub。

answer SSE 在正文静默期间每 10 秒发送 ping；客户端收到任何非空字节都会刷新活动时间。每 5 秒检查一次，空闲超过 45 秒便取消 reader，让悬挂的 read 结束。如果读循环退出时没有收到 done/error 且不是用户取消，调用 onError('连接已中断，请重试')，复用现有生成状态收尾。

**范围与 diff**

| 路径 | 本轮变化 |
| --- | --- |
| packages/server/src/routes/answer.ts:55、73 | +2 行：setInterval 心跳及 finally 清理，复用 send 的 aborted/destroyed 守卫 |
| packages/web/src/api/client.ts:335–400 | +25/-2：活动时间、watchdog、done/error 标志包装、异常 EOF 收尾及 finally 清理 |
| packages/server/src/routes/answer.test.ts | +41/-1：新增慢 provider 正常/错误结束两例 |
| packages/web/src/api/client-stream.test.ts | 新增 8 例：停滞、ping、分片活动、EOF、终态、abort、异常清理 |
| reports/coder-stream-heartbeat.md | 本报告，另有共享 reports 同名副本 |

开工时 git status 干净（Hub 已提交 R24 等历史改动）。packages 下 254 文件 SHA-256 基线比较：仅上表 3 个既有源码/测试变化和 1 个新增测试，0 删除；其余字节一致。未改依赖、DB、服务配置；未重启/杀服务，未 commit/push。

**停止条件核对**

- correct.ts:59–67 的 draft 直接 await service.draft 返回 JSON，commit 同为 JSON，没有 hijack/raw.write/SSE；按契约条件不改 correct.ts 或其测试。
- MainDoc.tsx:518–526 的 onError 更新节点为 error 并调用 generationTaskRegistry.settle；分叉、重试等路径也有同型逻辑。SubdocTabs.tsx:235–239 同样设置 error 并 settle。不存在契约指定的“错误通路缺失”阻塞，因此没有修改这两个文件。
- 心跳在 generate 正常和抛错两种收尾都 clearInterval；客户端正常完成、EOF、abort、read reject 时 watchdog 均清理。abort 继续走 onCancelled；非取消的 HTTP/read 异常仍按既有语义抛出，由调用方处理。

**当前运行证据**

命令均使用已安装的 Node 22.21.1（PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH）和 pnpm 10.33。

| 检查 | 当前运行结果 |
| --- | --- |
| pnpm -r test | exit 0：shared 34 / server 309 / web 362，合计 **705/705（695 → 705，+10）** |
| pnpm -r typecheck | shared/server/web 全部 Done，exit 0 |
| pnpm -r build | exit 0，307 modules，6.00s |
| 聚焦 answer.test.ts | 7/7 |
| 聚焦 client.test.ts + client-stream.test.ts | 22/22 |
| git diff --check | exit 0 |

全量仍有既有 React act 警告；构建仍有既有 >500 kB chunk 警告，没有新增门禁或变更阈值。

心跳用例：`sends heartbeats while the provider is silent and clears the timer on %s`，参数 complete/error（2 例）。真实路由经 app.inject 调用，provider 被 promise 暂停，fake interval 推进 20 秒；原始 SSE 输出按顺序为 ping,ping,chunk,done 或 ping,ping,error，完成后 timer count=0，再推进 20 秒仍为 0。fake timer 仅替换 interval/clearInterval/Date，不干扰 Fastify 自身 setImmediate 等调度。

客户端新增用例名：

1. cancels a stalled read after 45 seconds of inactivity and reports a disconnected stream once
2. ignores ping frames while refreshing activity until a normal done frame arrives
3. counts partial frame bytes as activity and expires only after that activity stops
4. reports EOF without done or error while retaining emitted chunks
5. does not add a disconnected error after a final %s frame without a trailing separator（done/error 两例）
6. preserves cancellation without reporting a connection error and clears the watchdog
7. preserves rejected reads and HTTP errors while cleaning timers

客户端使用真正的 ReadableStream 和可控假 fetch；无数据时 read 保持 pending，推进到 45 秒不取消，50 秒时 watchdog 取消并且 onError 只调用一次。持续 60 秒的 ping 不触发内容/错误回调，正常 done 仍正确结束。两段相隔 40 秒的不完整帧字节也续期；活动停止后才超时。所有新增终态路径均断言 timer count=0。既有 SSE chunk/done/error/visual 与 abort 测试原样通过。

**取舍与剩余 caveat**

- 45 秒是空闲阈值，按每 5 秒检测的下一轮触发；不是生成总时长上限。只要心跳持续，模型可以继续思考。浏览器后台调度可能延后检查时刻。
- 看门狗从获取 response.body reader 后开始；没有扩展为请求头到达前的 fetch 超时，也没有改 JSON correct 请求。
- 客户端断流后报告错误并保留已收到的内容，不主动查询 DB 补回丢失 done 帧。服务端可能已经生成完成，刷新仍可重新读取已保存结果；本轮没有触碰真实数据。
- 未做真实代理掐断或 owner 已卡页面的运行时复现；证据为当前路由/SSE fixture、计时测试及既有组件回归。现有页面需要加载新客户端后才具备 watchdog，服务是否需要重启由 Hub 安排。
- MainDoc/SubdocTabs 对 onError 文案有既有 humanize，实际 UI 会显示其“生成中断/可重试”文案，客户端准确错误消息不必逐字显示在界面。
