# Round 28 · Phase 2 独立代码审计：成文引擎 + 讨论经营

- 日期：2026-09-14。角色：audit（只读，零生产改动）。
- 对象：工作区未提交的 R28 Phase 2 全部改动（契约 A 服务端 + 标题去重补丁 + 契约 B web）。边界 = `git status` 实际工作区（22 modified / 8 new source + 3 reports），与三份交付报告逐一核对，无缺失、无规模异常。
- 依据：reports/plan-synthesize-2026-09-14.md、coder-synthesis-server.md、coder-synthesis-web.md、contracts/audit.md 七项必查清单。
- 方法：全量新增/修改代码逐行读 + 竞态静态推演 + 迁移顺序核对 + 独立复跑（不复用 coder 终端结果）。

## 独立验证证据（本轮亲自跑，非转述）

| 命令 | 结果 |
| --- | --- |
| `pnpm -r test`（Node v22.21.1） | shared 45/45 · server 385/385（60 files）· web 410/410（51 files）= **840/840，exit 0** |
| `pnpm -r typecheck` | 三包全过，exit 0 |
| `pnpm build` | 311 modules，exit 0（主入口 1089KB/gzip 386KB 为既有 chunk 体积告警，非本轮回归） |

## 结论（TL;DR）

**可以提交。无 P0。** 核心引擎（并发/取消/缓存/迁移/SSE/分享隔离/XSS）经逐行推演与测试佐证均正确，白名单遵守严格，**没有发现过度设计**——实现贴着既有 discussion 同构展开，plan Q1 砍掉 in-memory registry 的裁决被忠实执行。

但有 **2 个 P1**，都不阻断提交，建议在 owner 真实大树使用前处理；其中 P1-1 恰是本仓库 R16/R25 反复被咬的"同一概念多份实现"元教训，本轮在**客户端**又添了一份，值得点出。

---

## P0（阻断提交）

无。

---

## P1（建议修）

### P1-1 · SSE 读取/abort 骨架新增第三、四份拷贝——lineDiff 收口了，SSE 没收口

**这是本轮最该指出的"改造局限"**：plan Q6 让 coder 把服务端两份逐字节相同的 `lineDiff` 提成 shared（这件事做得干净，见下），但同性质的重复在 SSE 链路上**反向新增**了。

客户端（`packages/web/src/api/client.ts`）现有三份同构 SSE reader：

- `discussionStream` — client.ts:155
- `synthesisStream` — **本轮新增的第三份** — client.ts:226
- `streamAnswer` — client.ts:513（结构略异，但 getReader / 45s 看门狗 / TextDecoder / 空行分帧 / abort 清理同构）

`synthesisStream`（226-299）与 `discussionStream`（155-221）的骨架近乎逐行复制：同样的 `watchdog = setInterval(... 45_000, 5_000)`、同样的 `reader.cancel(signal?.reason)`、同样的 `terminal` 标志、同样的 `buffer.split(/\r?\n\r?\n/)`、同样收尾的 `if (!terminal) handlers.onError('连接已中断…')`、finally 里同样的 cancel+releaseLock。差异仅在事件类型分发。

服务端同样：`requestAbort` 在 routes/discussion.ts:10 与 routes/synthesis.ts:11 各一份（仅返回字段名 `signal` vs `controller` 之别），routes/answer.ts:38 还内联着第三份 abort 样板。

**具体失败场景**：R25 的僵尸流看门狗（45s/5s 探测）现在三份各写一遍。未来任何一次 SSE 协议调整——改空闲阈值、加 `event:` 字段、加重连、修分帧边界——只要改了 discussion/answer 而漏改 synthesisStream，就会出现"讨论流正常、成文流重新卡死"的局部回归，且类型系统不会报错（三份是独立函数）。这正是 R16 审计"≥6 条同根：同一概念多份实现"和 R25 修复要反复落地的同一个坑。

**建议**：提一个 `consumeSse(path, body, signal, onEvent)` 内部 helper（分帧+看门狗+abort+reader 清理共用），事件差异留给回调；服务端 `requestAbort` 提到 http 层 util。不要求本轮必须做（第三份拷贝自正确实现，当前行为正确），但**不建议拖到第三次再碰 SSE 之后**。置信度：高（行号实证）。

### P1-2 · 树级 LLM 输入（抽取问题 / 断点回顾）无总预算，20 节点长文档树可能超窗

plan Q2 的裁决有两条：综合阶段加树骨架（**已做**，synthesis-service.ts:141），以及"context-budget 泛化或新增综合专用预算，别硬套"（**未做**）。

现状预算只在**单节点蒸馏**生效（synthesis-service.ts:54，document 8000 + thread 6000，共享帽 16000 字符/节点）。但三个**树级**调用把逐节点材料原样 `JSON.stringify` 全量送出，provider 层无任何截断（已确认 codex-provider / anthropic-provider 不 slice 输入）：

- `extractQuestions` :162 — 每节点 `document + thread`（≤16000 字符）× N，外加全部已有 questions。20 节点最坏 ≈ **320k 字符**。
- `retrospective` :178 — 每节点最近 20 条讨论（≤6000+ 字符）× N + skeleton + merges。20 节点 ≈ 120k+ 字符。
- 综合调用 :141 — 输入是每节点蒸馏产物（prompt 写"约 600 字内"但**无硬约束**，模型可能写 2000+）× N。20 节点约 12-40k，风险较低。

**具体失败场景**：owner 的验收锚是"20 节点 <5 分钟"，真实树（购物车心理学，单节点正文约 4000 字符）走到 20 节点时点「抽取开放问题」或「生成回顾」，负载可达数十至上百 k tokens，可能超过 glm-5.3 经中转端点的实际上下文窗口 → 400/502 或默默烧超量 token。成文主路径（综合阶段吃蒸馏短文本）不受影响，Hub 已验证的 20 节点计时也只覆盖主路径——**这两个次级按钮的大树场景没有被验过**。

**边界诚实标注**：coder 交付报告已主动披露"树级输入体量随节点数增长；未引入额外全树裁剪策略或模型调用门禁"，Hub 验收时知情，不是藏雷。

**建议**：在 owner 用大树点这两个按钮前，加树级总预算（按节点数缩放每节点配额，复用 context-budget 的逐源降级思路），或对 extract/retrospective 也走预算。是否真超窗取决于模型窗口（本轮按成本纪律未实测），故代码事实=高置信度，实际触发=UNCERTAIN。

---

## P2（记录，不阻断）

| # | 位置 | 问题 | 触发/影响 |
| --- | --- | --- | --- |
| P2-1 | synthesis-service.ts:154 vs cancel | 综合 LLM 刚返回、`finish(done)` 落库前的极小窗口内若 cancel 先提交，整篇综合 `contentMd` 仅存内存被丢弃；重跑需再调一次综合（节点蒸馏全缓存） | 用户在完成瞬间点停止，窗口毫秒级，主动取消语义，轻微浪费 |
| P2-2 | synthesis-service.ts:47/49/58 | snapshot 每节点多次全表 `rows.filter`，约 O(3n²) | 数百节点时才有感；20 节点 O(400) 可忽略。建议改一次 Map 分组 |
| P2-3 | share-renderer.ts:42 | 公开分享 markdown 实例只有 markdown-it 默认协议黑名单（拦 javascript/data/vbscript/file，已实证），**没有** web markdown.ts:13 那样的 `https?/mailto` 白名单 → `ftp:`/自定义 scheme 放行。**既有行为，非本轮引入**，成文复用同渲染器未扩大面 | 自定义 scheme 理论上可唤起本地注册程序；html:false 已挡脚本主面。建议与 web 统一 `validateLink`（一行） |
| P2-4 | synthesis-service.ts:152 | `# ${tree.title}` 直接插值，title 仅 trim 不清洗（trees.ts:17）；含换行会注入额外 markdown 行 | 单用户应用、owner 自己输入、html:false 兜底，仅排版，非脚本注入 |
| P2-5 | client.ts:81 + VersionPanel.tsx:3 | 算法收口了，类型没收口：`VersionDiffLine`（client）与 shared `DiffLine` 结构相同仍双份，VersionPanel 用前者、SynthesisPanel 用后者 | 未来易混；建议 VersionPanel 改 import shared，删 client 的副本 |
| P2-6 | synthesis-service.ts:165-168 | extract 去重靠 `UNIQUE(tree_id,question)` + 空白归一，模型对已解决问题换个措辞返回会以 open 重新插入；question 文本无长度上限 | LLM 去重固有不精确，DB TEXT/UI 转义安全，影响轻微 |
| P2-7 | synthesis-service.ts / repo | 热路径多次 `db.prepare` 未复用 | better-sqlite3 prepare 有缓存，非泄漏，性能 nit |

---

## 契约七项必查清单逐条结论

1. **并发与取消竞态** — 通过。worker 并发数 `min(concurrency(), n)`，`Promise.allSettled` 收集后 :135 取首个 rejected 正确传播，无未处理 rejection；generate 错误在 worker 内 catch 转 failed 节点（:126-129），只有 check/abort 会 reject。取消双路径（cancel 端点置 DB + SSE heartbeat 每秒检测后 abort，route:58）汇合到 run 的 catch（:156）。save 先 `check()` 再在事务内要求 status='running'（repo:56），双保险；取消瞬间在途的单个节点结果不落库（取消语义，合理），已完成节点保留可复用。`begin()` 条件 UPDATE（repo:52）失败返回既有行，语义正确。唯一边界 P2-1。
2. **缓存正确性** — 通过。节点 cacheKey = digest(stored content_hash + canonical markdown 实际哈希 + 最后讨论消息 id + PROMPT_VERSION)（:56-59），实际正文哈希专门防"canonical 被改但 content_hash 陈旧"（有测试佐证 service.test:101）。全树 inputDigest 覆盖 tree.title + skeleton(含 verdict) + 各节点 cacheKey + merges + 章节配置（:66）——标题/verdict/结构变只重做综合，正文/讨论变只重蒸馏对应节点，分层正确。retrospective 再叠 questions 的 id/question/status/node_id（:174），resolve/reopen 正确失效，resolved_at 不参与（合理）。
3. **迁移安全** — 通过。三表 `CREATE TABLE IF NOT EXISTS` + 两个部分唯一索引（active node 与 active synthesis 互不冲突，schema.sql:167-170/connection.ts:167-170）；`nodes.verdict` ALTER 带 CHECK 且排在 migrateMerges 之后（connection.ts:129），符合 plan Q5；启动恢复把 queued/running 置 failed 并保留 node_results（:134），只在 openDb 执行、GET 不误杀；旧库升级/二次幂等/孤儿恢复/缓存保留由 connection.test:228 新用例覆盖，FK/integrity 双跑干净。document_shares 在 schema.sql 中先于 syntheses 定义但 FK 前向引用，全新 :memory: 库 840 测试已证可行。
4. **SSE 协议对齐** — 通过。服务端统一 `data: <JSON>\n\n`；客户端按 `\r?\n\r?\n` 兼容 CRLF/LF 分包，残帧留 buffer，TextDecoder `stream:true` 正确处理跨 chunk 的 UTF-8 多字节；ping 帧（`{type:'ping'}`）无匹配分支被安全忽略；done/error/cancelled 置 terminal；卸载 abort 后 `active.current=false` 静默、不刷终态。
5. **资源泄漏** — 通过。客户端 abort 的 signal 贯穿到 streamText 内部 controller（discussion-service.ts:37-39），联动 abort provider 并 `iterator.return()`（:73），**断连不会傻跑完 LLM**；heartbeat/interval 在 route finally（:69）与 client finally（:296）均清理，reader cancel+releaseLock。
6. **注入与转义** — 通过（主面）。成文 contentMd 走 markdown-it `html:false`（share-renderer:42 与 web markdown.ts:9），模型产出的 HTML/脚本被转义；web 另有 `https?/mailto` 协议白名单。开放问题在 React 中以 `{question}` 文本渲染、不进分享。残留 P2-3（share 默认黑名单弱于 web 白名单，既有）与 P2-4（title 注入，排版级）。
7. **过度改造门禁** — 见下节专审。**未发现过度设计，白名单零越界。**

---

## 过度改造门禁审计（对应"是否改造过于复杂"）

**结论：未见过度改造，复杂度与需求匹配，且多处体现了克制。**

- 白名单逐文件核对（以我实跑 `git status` 为准，非会话开始时的旧快照）：新增 synthesis-service/repo/open-questions-repo/routes + 测试、shared line-diff、web SynthesisPanel；修改的 22 个文件全部对应契约授权（lineDiff 收口 4 文件、分享 4 文件、wiring 3 文件、MainDoc/CSS/discussion-service 授权小改）。
- `MainDoc.tsx` 实证恰 +2 行（import + `<SynthesisPanel key={node.tree_id}>`）；`Workbench.css` +32 行纯追加、全部 `.synthesis-` 前缀、未触碰 R8/R10/R20 的 pre/code 几何保护区；`discussion-service.ts` 仅 export streamText + timeout 参数化（默认 45000，既有调用不传参→行为零变化）+ digest 一行 verdict 标记，三处。
- **没有为未来假设造抽象**：无 job/task registry 基类（plan Q1 的裁决被忠实执行，重启僵尸由"纯 DB 行 + 请求作用域 SSE"架构性消除）、无通用 repository 基类、无新依赖。
- 复用恰当而非另起炉灶：90s 超时通过给既有 streamText 加参数实现（没写第二套看门狗）；SECTIONS 数据驱动配置（复用 DISCUSSION_MOVES 模式）；synthesis 分享复用 token/管理接口体系而非新分享类型；错误类型 SynthesisError/SynthesisRunningError 与既有 DiscussionError 同构。
- 唯一"为正确性付出的略重"设计（retrospective 双层 digest、footnote 编号）均有明确缓存失效用途，非空转。

## 改造局限性 / 同根漏改审计（对应"是否只改了一处、别处同类问题还在"）

- **lineDiff 收口彻底（正例）**：server diff.ts + 测试删除、versions.ts 改 import、web CorrectiveMergeButton 删本地实现，三处算法消费方全部统一 shared，全库 grep 无残留算法定义。唯一尾巴是类型双份（P2-5）。
- **SSE/abort 是反例（P1-1）**：识别重复的雷达覆盖了 lineDiff 却没覆盖客户端 reader 与服务端 requestAbort，本轮新增第三/四份。
- **verdict 闭环完整**：digest 改读 nodes.verdict（discussion-service:107）+ synthesis snapshot 直接读 row.verdict（:59）+ 决策日志读 nodes/merges，plan Q5 要求的三处都接上了，无"只改 digest 漏了成文"。
- **协议白名单不一致是历史旧账（P2-3）**：web 有、share 无，非本轮引入，本轮也未顺手统一——记录但不归责本轮。
- **标题清洗（P2-4）** 是全站性输入卫生的一个小点，单列影响低。

---

## 给 Hub 的处置建议

1. **可提交**：无 P0，840/typecheck/build 独立复现 exit 0，迁移幂等与分享隔离有真实测试，无过度设计。
2. P1-1（SSE/abort 提共享 helper）建议作为紧跟的小收口轮——成本低，且直接对冲本仓库 R16/R25 元教训；P1-2（树级预算）在 owner 对 20 节点长文档树点「抽取开放问题/生成回顾」之前补。
3. P2 可入 backlog；其中 P2-3（share validateLink 白名单）与 P2-5（DiffLine 类型收口）都是一行量级，可与 P1-1 同批带走。
