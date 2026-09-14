# Round 28 · Phase 2 反证审计：一键成文（synthesize）+ 讨论经营（plan）

- 日期：2026-09-14
- 角色：plan（实现设计反证，只读，零生产代码改动）
- 审计对象：Hub Phase 2 实现设计初稿（contracts/plan.md §「待反证的实现设计」1–9）
- 产品范围既定（docs/brainstorm-workbench-2026-09-13.md §Phase 2，owner 已拍板，commit 019d2ea 同仓库）——本轮**只反证实现设计，不做产品再设计**。
- 方法：全部裁决基于当前仓库源码取证（file:line），含 Phase 1 已落盘基础设施（commit 019d2ea：discussion-service / context-budget / discussion route / saveDocumentContent 导出）。Q6 diff 实现我逐字节比对确认。

## 摘要（TL;DR）

Phase 2 **实现路径大部分已由 Phase 1 铺好**——synthesize 要的每个机制都有现成先例可复用（SSE+心跳、45s 双语义 watchdog、数据驱动 moves、saveDocumentContent 导出、treeDigest、逐节点 streamText）。这让 Phase 2 比表面看**风险更低**。但有 **1 个 major 架构缺陷 + 3 个必须收口的裁决 + 明确的 Q6 定论**：

1. **[MAJOR·Q1] in-memory registry 是本代码库从未有过的新失败模式**：全仓库**零长驻后台任务**（实证：无 job/task registry，所有 LLM 调用都是请求作用域的 SSE 连接）。Hub 的"in-memory registry + DB 行"混合会在 server 重启（tsx watch 改一行就重启）时产生僵尸行。**建议砍掉 in-memory registry，纯 DB 行 + 请求作用域 SSE 执行**（与 discussion.ts 完全同构），"可中断续跑"用节点级 content_hash 缓存实现即可，无需常驻 registry。详见 Q1。
2. **[Q6 定论] lineDiff 是两份逐字节相同的 LCS**：CorrectiveMergeButton.tsx:52-86（web）与 diff.ts:6-42（server）算法**完全一致**，仅返回类型名不同（VersionDiffLine vs DiffLine，结构同）。**推荐提 shared 一份**，P2 rerun-diff 复用，禁第三份。
3. **[Q5 定论] verdict 不该加在 merges 上**：merges 语义是"source 并入 target"（schema.sql:93-102），不是"分支被否决"。verdict 挂 merges 是语义错配。建议 verdict 作 nodes 的一等字段（或独立 decisions 表），digest 已在读它（discussion-service.ts:96-107 现从 merges 反推 `[已合并]`，非 `[已否决]`）。
4. **[Q3 已解] 看门狗语义已存在**：discussion-service.ts:40-46 的 streamText **已实现非流式 45s watchdog**（`subscribeToActivity` 为空时=45s 无响应超时）。P2 逐节点蒸馏是非流式调用，直接复用这条路径，Q3 的"45s 取值待反证"已有答案。

逐条裁决如下（对应契约 Q1–Q10）。

---

## Q1 — 执行模型：in-memory registry + DB 行混合，重启僵尸/孤儿

**裁决：CHALLENGE（MAJOR）——砍 in-memory registry，纯 DB 行 + 请求作用域 SSE。**

- **实证：本代码库零长驻后台任务**。grep 全 service/routes 无 job/task registry（Map 命中全是数据分组：share-service.ts:39/55/67 等）。所有 LLM 执行都是**请求作用域**——SSE 连接held 开着，连接断=abort（discussion.ts:10-25 requestAbort、answer.ts:42-50）。**从未有过"请求返回后仍在后台跑的任务"**。
- in-memory registry 引入**全新失败模式**：
  - **重启僵尸**：dev 是 tsx watch，改任何 server 文件就重启（index.ts 无持久化 registry）。synthesize 跑到一半重启 → in-memory registry 蒸发，但 DB 行停在 `status='running'` → **僵尸行**，前端轮询永远等不到。
  - **孤儿**：DB 行说 running，实际无进程在跑。需要"重启恢复语义"——但这是**给一个本不需要的架构补丁**。
- **更简单诚实的实现（推荐）**：**纯 DB 行 + 请求作用域 SSE，与 discussion.ts 同构**：
  - `POST /api/trees/:id/synthesize` 开 SSE（复用 discussion.ts:45-79 的 hijack+writeHead+heartbeat+abort 骨架），**在这一个请求内**逐节点蒸馏 → 综合 → 写 syntheses 行 → `done`。
  - "可中断续跑"= **节点级 content_hash 缓存**（草案已有此设计）：syntheses 或一张 `synthesis_nodes(synthesis_id, node_id, content_hash, distilled)` 表存每节点蒸馏产物；重跑时 content_hash 未变则跳过 LLM，直接取缓存。**中断=SSE 断，重跑=新请求，命中缓存的节点秒过**。这不需要 registry。
  - 重启语义**天然正确**：没有 running 行遗留（请求作用域，连接断即结束，DB 行只在成功时落 `status='complete'`；中途断则不写终态行或写 `status='interrupted'`，重跑覆盖）。
- **反对 registry 的核心理由**：草案的"异步任务 registry"是在**模仿一个这个应用没有的架构**（job queue）。20 节点 <5 分钟（Q10）完全在一个 SSE 连接的生命周期内（discussion 单轮就能跑 45s+，心跳保活）。**不需要把请求作用域的东西升级成常驻任务**。

> CHALLENGE（MAJOR）：砍 in-memory registry。纯 DB 行 + 请求作用域 SSE（复用 discussion.ts 骨架）+ 节点级 content_hash 缓存实现续跑。重启僵尸问题**由架构消除而非补丁**。若 Hub 坚持 registry，则必须答"重启恢复"——但那是自找的复杂度。

---

## Q2 — 逐节点蒸馏输入 + token 预算接 context-budget

**裁决：CHALLENGE——逐节点自身+讨论不够综合阶段用（缺树结构骨架）；token 预算 context-budget.ts 是三源不是通用，综合阶段需扩或另配。**

- **蒸馏阶段输入**：节点自身+其讨论摘要，不含父/祖先全文（防 R17 回声）——**CONFIRM 这层对**。R17 实证逐分支小分支负蒸馏 3.5-11×（TASK.md #91），逐节点避坑。
- **但综合阶段缺树结构**：Q2 自问"综合阶段是否需要树结构骨架"——**需要**。六章节里"核心分歧/被否决方案/决策与理由"**本质是关系性的**（谁 vs 谁、哪个分支否决了哪个）。若综合阶段只拿到 20 段互相独立的节点蒸馏、无父子/兄弟结构，LLM **无法还原分歧结构**，只会输出 20 段流水账。**建议**：综合阶段输入 = 逐节点蒸馏产物 **+ 树骨架**（父子边 + 兄弟分组 + merges 方向 + verdict），骨架用轻量结构（类似 treeDigest discussion-service.ts:94-114 的"标题+一行"，但带边关系）。血缘脚注也依赖这个骨架（节点 id→标题映射）。
- **token 预算接 context-budget.ts**：
  - 实证 context-budget.ts 是**三源专用**：`{document, thread, digest}`（context-budget.ts:58-62），配额 documentChars/threadChars/digestChars（context-budget.ts:1-7）。**这是为讨论层设计的，不是通用预算器**。
  - synthesize 的两阶段预算**源不同**：蒸馏阶段源=`{节点内容, 节点讨论}`；综合阶段源=`{N 段蒸馏, 树骨架}`。**硬套三源 budgetDiscussionContext 语义不符**。
  - **建议**：①蒸馏阶段可复用 budgetDiscussionContext（document=节点内容、thread=节点讨论、digest=空），语义勉强贴合；②**综合阶段需要新的预算函数**（N 段蒸馏各自配额 + 骨架配额 + 输出预留），或把 context-budget.ts 泛化成"命名源 + 各配额 + 逐源降级"的通用器（trimDocument/trimThread/trimDigest context-budget.ts:14-55 的降级逻辑可复用，但源集要参数化）。**推荐泛化**，避免 synthesize 再写第三套预算逻辑（R16 重复实现教训）。

> CHALLENGE：蒸馏输入对（防回声），但综合阶段必须加树结构骨架（否则六章节的关系性内容无法还原）；context-budget.ts 是三源专用，综合阶段需泛化预算器或新增综合专用预算，别硬套讨论三源。

---

## Q3 — 看门狗与并发

**裁决：CONFIRM（看门狗语义已存在，复用即可）；CHALLENGE 并发 2 需按 provider 实证，给保守默认。**

- **看门狗已解**：Q3 问"非流式蒸馏 45s 取值待反证"——**Phase 1 已实现**。discussion-service.ts:40-46 的 streamText：`subscribeToActivity` 为空（非 SSE）时 = **45s 无响应超时**（"讨论生成超过 45 秒没有响应"）；有 SSE 时 = 45s 无写入超时。**P2 逐节点蒸馏是非流式内部调用**（草案 item 1"每节点一次 LLM 调用"），直接复用 streamText 无 subscribeToActivity 分支 = 45s 无响应看门狗。**不需要新取值**。
- **但 45s 对思考型模型的风险**（Phase 1 perspectives 教训，契约 Q3 点名）：glm-5.3 是思考型，思考阶段无文本产出（R25 根因 TASK.md #60）。非流式 `provider.complete`/streamText 无 subscribeToActivity 时，**思考期也在 45s 计时内**——若某节点内容长、思考久，可能 45s 误杀。**建议**：蒸馏调用的看门狗放宽到 **60-90s**（可配），或蒸馏也走 streamText 的 SSE 分支（有 chunk 就 reset，避免思考误杀）——但蒸馏是内部循环不对外 SSE，所以**放宽超时**更简单。**标 UNCERTAIN 的部分**：确切阈值需真实 glm-5.3 单节点蒸馏耗时实测（见 Q10，不自行调用，成本纪律）。
- **并发 2**：
  - Phase 1 discussion 是**单请求单流**，从未并发打 provider。并发 2 是新行为。
  - provider 限流未知（bigmodel/内网端点的 QPS 限制无实证）。**并发 2 若触发 429/限流 → 整批失败**。
  - **建议**：默认并发 **2 保守**可接受，但**必须有并发失败隔离**（单节点 429 重试/降级，不整批炸——复用 Phase 1 perspectives "部分成功保留"教训 docs §P1）+ 并发数走 settings 可调（复用 discussion.context.* settings 先例 discussion-service.ts:87）。**不建议默认 3+**（未知限流下越并发越险）。

> CONFIRM 看门狗（复用 streamText 非流式 45s，但建议放宽到 60-90s 防思考误杀，确值 UNCERTAIN 待实测）；CHALLENGE 并发需失败隔离+可配，默认 2 保守不加。

---

## Q4 — syntheses 表形状

**裁决：CONFIRM 分列（sections_json + footnotes_json + content_md）；补 diff 所需字段。**

- 实证 diff 复用需求（Q6）：rerun diff = 两次 synthesis 的 content_md 做 lineDiff。**所以 content_md 必须存全文**（不能只存 sections_json 让前端拼——拼法不稳定则 diff 噪声大）。
- **建议形状**：
  - `content_md TEXT`——最终成文全文（diff 的输入，也是 share-renderer 的输入 Q7）。
  - `sections_json TEXT`——六章节结构化（前端分章节渲染/折叠，不用重新解析 md）。
  - `footnotes_json TEXT`——脚注血缘 `[{n, nodeId, title}]`（脚注可点跳转，节点 id→标题）。
  - `tree_id, status, created_at, model` + **`input_digest TEXT`**（本次成文覆盖了哪些节点+各自 content_hash，用于"哪些节点变了需重蒸馏"的续跑缓存 Q1，也让 diff 能标注"来源变化"）。
- **diff 重跑要存什么才能可视化**：存 content_md 足够做行级 diff（LineDiffView 消费）。若要"章节级 diff"（这章变了），需 sections_json 对比——**建议 v1 只做 content_md 行级 diff**（复用 LineDiffView），章节级 diff 是 v2。
- **反对单 content_md + 元数据**：脚注和章节结构若只在 md 里，前端要正则解析 `[^n]` 和 `##` 标题——脆弱（R26 裸 JSON 教训的近亲：把结构塞进文本再解析）。**分列更稳**。

> CONFIRM 分列（content_md + sections_json + footnotes_json + input_digest）；diff v1 用 content_md 行级（复用 LineDiffView），章节级 diff 延 v2；脚注/章节分列存，别塞 md 再解析。

---

## Q5 — merges 加列 vs decisions 新表 + verdict 三源不闭环

**裁决：CHALLENGE 加列 merges——语义错配。verdict 作 nodes 一等字段；决策日志读 merges（已有）不加列。**

- **verdict 三源不闭环（找到 file:line）**：R28 Phase 1 我已裁决，此处补实证。现 digest **从 merges 反推**：discussion-service.ts:96 `merged = new Set(merges.listByTree().map(m => m.source_node_id))`，:107 标 `[已合并]`。**这是"已合并"不是"已否决"**——merges 记录的是"source 并入 target"（schema.sql:93-102 conclusion/direction/kind），是**融合**语义。
  - 三源打架实证：①merges.direction（correct 的纠正方向 schema.sql:100）=父被子纠正，≠分支否决；②open_questions.resolved（P4 新表）=问题解决，≠分支否决；③人工标记=唯一真表达否决但草案无入口。**从三者任一反推 verdict 都会误标**（把"被纠正的父"或"已合并的子"误当否决）。
- **merges 加列 verdict 是语义错配**：merges 一行是"一次并入事件"，verdict 是"一个节点的裁定状态"——**基数不同**（一个节点可能有 0 或多次 merge，verdict 是节点级单值）。verdict 挂 merges 无处安放"从未 merge 但被否决"的节点。
- **迁移可行性**（若要加列）：connection.ts:54-101 的 `PRAGMA table_info + ALTER ADD COLUMN` 幂等框架支持（trees.folder 先例 connection.ts:59）。真实库 merges 6 行（R20 取证 TASK.md），`ALTER TABLE merges ADD COLUMN verdict TEXT` 幂等安全。**但即使技术可行，语义仍错**。注意 merges 还有 R18 的表重建迁移 migrateMerges（connection.ts:144+）——加列要放在重建之后或纳入重建，避免顺序坑。
- **推荐**：
  - **verdict 作 nodes 一等字段**：`ALTER TABLE nodes ADD COLUMN verdict TEXT`（active/rejected/superseded，默认 null=active）。人工标 + 成文时 AI 建议。digest 读 nodes.verdict 而非反推 merges。
  - **决策日志读 merges（不加列）**：merges 已含 direction/kind（schema.sql:99-100），决策日志自动条目直接读，手动补录进 open_questions 或单独 decisions——但 P4 决策日志 v1 **可只做"读 merges 展示"**，不必新表。
  - **open_questions 独立表**：net-new（实证无），`CREATE TABLE IF NOT EXISTS`（tree_folders schema.sql:1-4 先例，无需 PRAGMA）。

> CHALLENGE 加列 merges（语义/基数错配）；verdict 作 nodes 一等字段（ALTER 幂等，注意排在 migrateMerges 后）；决策日志 v1 读 merges 不加列；open_questions 独立表。digest 改读 nodes.verdict 闭环。

---

## Q6 — LineDiffView 复用 vs 提 shared

**裁决：CHALLENGE——提 shared。两份 lineDiff 逐字节相同，是确定的重复债，本次是收口时机。**

- **逐字节比对实证**（我直接读了两处）：
  - `packages/web/src/components/CorrectiveMergeButton.tsx:52-86` `lineDiff(before, after): VersionDiffLine[]`
  - `packages/server/src/service/diff.ts:6-42` `lineDiff(before, after): DiffLine[]`
  - **算法完全一致**（同一 LCS：lengths 表逆序填充 + 正序回溯，同样的 `lengths[i+1][j] >= lengths[i][j+1]` 分支）。**唯一差异是返回类型名**：`VersionDiffLine` vs `DiffLine`，而两者结构相同（`{text: string; type: 'same'|'add'|'del'}`，diff.ts:1-4 与 shared 的 VersionDiffLine）。
- **视图**：`LineDiffView` 单份（VersionPanel.tsx:146），无重复。消费方：CorrectiveMergeButton（web 端本地算 lineDiff 预览）、VersionPanel（调 server /versions/:from/diff/:to → diff.ts）。
- **"第三份实现"债的真相**：R16/R18 记的"lineDiff 第三份"——当前实证是 **2 份算法**（web+server）。若加 P2 rerun-diff 再写一份就是**真第三份**。
- **推荐：提 shared 一份**：
  - `packages/shared/src` 导出 `lineDiff` + `DiffLine` 类型（shared 已有纯函数先例：sanitizeTagList/normalizeMarkdown 等）。
  - web CorrectiveMergeButton、server diff.ts、P2 rerun 三处 import 同一份。
  - 成本：**低**（纯函数搬移 + 改 3 处 import + 类型统一 VersionDiffLine=DiffLine）。收益：消灭确定重复 + P2 不产生第三份。
- **反对"复用现有 web LineDiffView 就够"**：LineDiffView 是**渲染组件**（Q6 说的是**算法**）。P2 rerun 若在 server 算 diff（content_md 对比），要用 server 侧 lineDiff——那就是复用 diff.ts 或 shared。**渲染复用 LineDiffView（web 组件）没问题，算法必须提 shared 否则第三份**。

> CHALLENGE：提 shared。两份 lineDiff 逐字节同（CorrectiveMergeButton.tsx:52 / diff.ts:6），低成本收口，P2 rerun 复用 shared 算法 + LineDiffView 组件，杜绝第三份。这是 R16/R18 债的正解时机。

---

## Q7 — share-renderer 接线

**裁决：CHALLENGE 现状（成文默认分享不出去）；最小侵入 = synthesis 作为可分享文档源，扩展而非新分享类型。**

- **现状实证**：share-renderer 消费 `ShareDocument`（share-renderer.ts:20-27）= tree + ShareNode 树（row+children，:36-39），渲染 `documentContentOf(node.row)`（:114/177/193），复用 normalizeMarkdown（:5）。**只认 nodes 树**。
- **成文存树外**（syntheses 表，Q4/草案 item 2）→ **不是 node** → **默认分享不可见**。这与 P0 discussion 分享不可见同源，但 synthesis **本就该能分享**（"生成更好的文档带走"是 owner 目标）。
- **最小侵入路径**：
  - synthesis 已有 `content_md`（Q4）——**它就是一篇 markdown 文档**。分享 synthesis = 把 content_md 喂给现有渲染管线。
  - **不新造分享类型**：现 document_shares 表（schema.sql:126-136）是 `(tree_id, node_id, token_hash...)`——绑 node。synthesis 无 node_id。两条路：
    - **A（推荐，最小）**：分享 synthesis 时，token 绑 tree_id + synthesis_id（document_shares 加可空 `synthesis_id` 列，幂等 ALTER）；share 渲染路径判断：有 synthesis_id → 渲 syntheses.content_md（走 normalizeMarkdown 同管线），否则走现有 node 树。
    - **B**：synthesis 分享复用 node 分享（把 content_md 临时挂个虚拟 node）——**否决**（污染 nodes，违反树外原则）。
  - content_md 已是 markdown 且 normalizeMarkdown 可直接处理（share-renderer.ts:165 先例），**渲染零新逻辑**，只需分享入口识别 synthesis。
- **脚注血缘在分享里**：footnotes_json 的 `[^n]→node` 在分享页**跳不动**（分享是静态快照，无应用内导航）。**建议**：分享版脚注降级为"来源：节点标题"纯文本（不可点），或列在文末来源区。

> CHALLENGE：成文默认分享不出去。最小侵入 = document_shares 加可空 synthesis_id，share 渲染分支渲 content_md 走 normalizeMarkdown 同管线（零新渲染逻辑），不新造分享类型不挂虚拟 node；分享版脚注降级纯文本来源。

---

## Q8 — 活总结自动刷新时机

**裁决：CONFIRM 砍自动刷新到 v1 之后（只手动重跑）。**

- 草案 item 8 Hub 倾向砍——**同意**。理由：
  - **成本**：synthesize 是 20 节点 20+ LLM 调用、<5 分钟的重操作（Q10）。"沉淀/讨论完成事件去抖刷新"= 每次 promote/discuss 后可能触发一次 5 分钟全树重蒸馏。去抖窗口再大，**自动触发一个 5 分钟 × 20 调用的操作是危险默认**（用户 promote 一下，后台默默烧 20 次 LLM）。
  - **一致性**：活总结要与树状态同步，但树在脑暴中高频变——自动刷新会频繁作废，缓存意义降低。
  - **R25 教训**：长时间后台生成无反馈=卡死观感。自动触发的成文用户看不到进度。
- **v1 只手动重跑**：用户显式点"重新成文"，看得到 SSE 进度。**活总结开关（settings 键）v1 可先不做**——或只做"标记为脏"（树变了则成文页显示"内容已更新，可重新成文"提示），不自动跑。
- settings 键先例：discussion.context.*（discussion-service.ts:87）——若要加开关，`synthesis.autoRefresh` 默认 false。

> CONFIRM 砍自动刷新；v1 只手动重跑（SSE 有进度），可加"已过期"脏标记提示但不自动跑，autoRefresh settings 键默认 false 延后。

---

## Q9 — 六章节骨架数据化 vs 硬编码 prompt

**裁决：CONFIRM 数据化（配置驱动），有 Phase 1 直接先例。**

- **先例实证**：Phase 1 的 DISCUSSION_MOVES 就是**数据驱动配置**（discussion-service.ts:10-21）——move={instruction, steps:[{label, instruction}]} 的对象字面量，route 校验 `Object.hasOwn(DISCUSSION_MOVES, move)`（discussion.ts:90）。六章节骨架**同构**：`SECTIONS = [{key:'background', title:'背景', instruction:'...'}, ...]`。
- 数据化收益：①owner/未来可调章节顺序/增删；②综合 prompt 从配置生成（章节标题+每章指令）；③测试可枚举章节。
- **但六章节是"一次综合调用组装"**（草案 item 3），不是六次调用——所以数据化的是**综合 prompt 的章节清单**（喂给一次 LLM 调用"按这六章组织"），不是六个独立 move。**这点要清晰**：DISCUSSION_MOVES 是"一个 move 多 step 多次调用"（perspectives 三次），六章节是"一次调用产出六章"——数据化形态相似但执行不同。
- **反对硬编码 prompt**：把六章节写死在一个字符串模板里，改章节要动代码+测试。配置化后改章节=改数据。**成本相近，可维护性配置胜**。

> CONFIRM 数据化（复用 DISCUSSION_MOVES 配置模式）；澄清六章节是"一次综合调用的章节清单配置"，非六个独立 move。

---

## Q10 — 20 节点 <5 分钟验收锚可行性

**裁决：UNCERTAIN（需真实 glm-5.3 单节点蒸馏耗时实测，成本纪律不自行调用）；给实验设计 + 若不可行的替代。**

- **算术**：20 节点逐个蒸馏（串行则 20 次）+ 1 次综合 = 21 次 LLM 调用。<5 分钟 = 平均每次 **<14.3s**（串行）。
- **并发 2 则**：20 节点 /2 = 10 批 × 单次耗时 + 1 综合。若单次 15s → 10×15 + 15 = 165s ≈ 2.75 分钟。**并发 2 下 5 分钟可行性较高**。
- **风险（为何 UNCERTAIN）**：
  - glm-5.3 是**思考型**（R25 根因：思考阶段耗时且无产出 TASK.md #60）。单次蒸馏若含长思考，可能 20-40s，非 15s。
  - 综合调用输入大（20 段蒸馏+骨架），输出长（六章节全文），可能 30-60s+。
  - **串行 20×30 + 60 = 660s = 11 分钟 → 超标**。**并发是 <5 分钟的必要条件**。
- **实验设计（不自行调用，建议 Hub 验收时测）**：①单节点蒸馏真实耗时 n=3（短/中/长节点）；②综合调用真实耗时 n=1；③据此定并发数。**验证命令**：临时实例 + 真实树（owner 购物车心理学笔记有 20+ 节点候选）+ 计时 SSE done 帧。
- **若不可行的替代**（按契约要求预置）：
  - **并发 3**（未知限流下需失败隔离 Q3）；
  - **分批 SSE**：每节点蒸馏完就 SSE emit 一段进度（用户看到"12/20 节点已蒸馏"），5 分钟内出全部≠一次性等——**降低"卡死"观感**（R25 教训），即使总耗时略超也可接受；
  - **降节点门槛**：>N 节点的树提示"树较大，成文约需 X 分钟"预期管理，或只成文活跃分支（非全树）；
  - **节点级缓存**（Q1）让**重跑**秒过（只重蒸馏变化节点），首次慢但迭代快。
- **强烈建议**：无论耗时，**必须 SSE 分批进度**（每节点完 emit）——否则又是 R25 长时间零反馈卡死。这比"总耗时是否 <5 分钟"更重要。

> UNCERTAIN：<5 分钟依赖真实耗时（glm-5.3 思考型 + 综合大调用），并发是必要条件。实验设计交 Hub 实测（不自调用）。无论如何**必须 SSE 分批进度**（防 R25 卡死观感）+ 节点缓存让重跑快。替代：并发 3/分批/降门槛/活跃分支。

---

## 实现设计缺陷清单（分级）

| 级别 | 缺陷 | 位置/证据 | 处置 |
|---|---|---|---|
| **MAJOR** | in-memory registry 引入本库从未有的长驻任务失败模式（重启僵尸） | 全库无 registry 先例；discussion.ts 全请求作用域 | 砍 registry，纯 DB 行+请求作用域 SSE+节点缓存（Q1） |
| **MAJOR** | 综合阶段缺树结构骨架，六章节关系性内容无法还原 | 逐节点蒸馏无边关系（Q2） | 综合输入加树骨架（父子/兄弟/merges/verdict） |
| MAJOR | verdict 加 merges 语义/基数错配 | merges=并入事件 schema.sql:93-102；digest 反推 discussion-service.ts:96-107 | verdict 作 nodes 一等字段（Q5） |
| MINOR | lineDiff 两份逐字节重复，P2 将成第三份 | CorrectiveMergeButton.tsx:52 / diff.ts:6 | 提 shared 一份（Q6） |
| MINOR | 成文默认分享不出去 | share-renderer 只认 node 树 :36-39/:114 | document_shares 加 synthesis_id，渲 content_md（Q7） |
| MINOR | context-budget 三源专用，综合阶段硬套语义不符 | context-budget.ts:58-62 | 泛化预算器或综合专用预算（Q2） |
| MINOR | 45s 看门狗对 glm-5.3 思考型可能误杀 | streamText 非流式 45s discussion-service.ts:43-45 | 蒸馏超时放宽 60-90s（Q3，确值 UNCERTAIN） |

---

## 推荐的契约拆分（供 Hub 直接采用）

**建议拆两份 coder 契约（server 先、web 后，或并行但 server 是 web 的前置）**：

**契约 A · server（synthesize 引擎 + P4 数据层）**
- 写权白名单：新增 `packages/server/src/service/synthesis-service.ts` + test、`routes/synthesis.ts` + test、`repo/synthesis-repo.ts` + test、`repo/open-questions-repo.ts` + test；改 `db/schema.sql`（syntheses/open_questions 表 + nodes.verdict 列）、`db/connection.ts`（幂等迁移，verdict ALTER 排在 migrateMerges 后）、`deps.ts`（wire，复用 deps.ts:66-67 模式）、`app.ts`（registerSynthesisRoutes）；提 `packages/shared/src` 的 lineDiff（Q6）+ 改 diff.ts/CorrectiveMergeButton import。
- 复用强制：SSE+心跳+abort 复用 discussion.ts:45-79 骨架；蒸馏调用复用 streamText（discussion-service.ts:35，超时放宽）；六章节配置化复用 DISCUSSION_MOVES 模式；**写 document_content 若有（活总结落文档）走 saveDocumentContent（document-content.ts:77）——但 Q8 砍自动刷新，v1 synthesis 存 syntheses 表不写 document_content**。
- 停止条件：①若 synthesize 需要写 document_content（第二条写路）→ blocker（Q3 裁决仍在）；②若发现 20 节点 5 分钟结构性不可行 → blocker（Q10）。
- 回归锁：788→791 基线不破（契约 item 9）；不新增 document_content 写路径；merges 迁移不破坏现有 6 行 + R18 表重建。

**契约 B · web（成文页 + diff + P4 UI）**
- 写权白名单：新增 `SynthesisView.tsx`/`OpenQuestionsPanel.tsx` + test、client.ts 加 synthesize/listSyntheses/openQuestions 方法；改 MainDoc.tsx **挂载点 ≤±2 行**（Phase 1 DiscussionStrip 先例 MainDoc.tsx:985）；复用 LineDiffView（VersionPanel.tsx:146）渲 rerun diff；Workbench.css **前缀追加**（契约 item 9）。
- 回归锁：MainDoc 挂载 ≤N 行；CSS 前缀追加不动保护区（R8/R10 1285-1312、R20 P0 块）。

---

## 停止条件自检

- **不触发"方案级不可行"**：Phase 1 已证机制齐备（SSE/watchdog/saveDocumentContent/moves 配置/treeDigest），synthesize 是这些的组合，无结构性不可行。**唯一 UNCERTAIN 是 20 节点 5 分钟耗时**（Q10）——需实测，非结构性否决，故不 blocker，标 UNCERTAIN + 实验设计。
- **不需真实 LLM 才能裁决的问题我已标 UNCERTAIN**（Q3 超时确值、Q10 耗时）——未自行调用（成本纪律）。
- 零数据风险（本轮零代码改动）；不新增 document_content 写路径（Q8 砍自动刷新使 synthesis 存独立表，Q3 裁决守住）。
- 仓库状态与 docs/TASK.md 一致（Phase 1 commit 019d2ea 在场，discussion-*/context-budget 已落盘）。

---

## 给 Hub 的结论

Phase 2 实现路径**大部分已由 Phase 1 铺好，风险低于表面**。放行 coder 前建议纳入：

1. **[MAJOR·Q1] 砍 in-memory registry**——纯 DB 行 + 请求作用域 SSE（复用 discussion.ts 骨架）+ 节点 content_hash 缓存续跑。消除重启僵尸，而非补丁。
2. **[MAJOR·Q2] 综合阶段加树结构骨架**——否则六章节关系性内容（分歧/否决/理由）无法还原；context-budget 泛化或综合专用预算。
3. **[MAJOR·Q5] verdict 作 nodes 一等字段**，不加 merges（语义/基数错配）；决策日志 v1 读 merges 不加列；digest 改读 nodes.verdict 闭环。
4. **[Q6] lineDiff 提 shared**（CorrectiveMergeButton.tsx:52 与 diff.ts:6 逐字节同），P2 复用，杜绝第三份。
5. **[Q7] 成文分享**——document_shares 加 synthesis_id 渲 content_md 走 normalizeMarkdown 同管线，不新造类型。
6. **[Q10] 必须 SSE 分批进度**（每节点 emit，防 R25 卡死观感）；<5 分钟依赖真实耗时，标 UNCERTAIN，Hub 验收实测定并发。
7. **[Q3/Q8/Q9] 复用既有**：看门狗放宽 60-90s 防思考误杀；砍活总结自动刷新（v1 手动重跑）；六章节配置化（DISCUSSION_MOVES 模式）。

零生产代码改动（本报告）。停止条件均未触发（Q10 标 UNCERTAIN 非 blocker）。契约拆分建议见上（server 前置 web）。
