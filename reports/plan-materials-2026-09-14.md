# Round 28 · Phase 3 反证审计：素材导入（文本粘贴）

- 日期：2026-09-14
- 角色：plan（实现设计反证，只读，唯一可写本报告）
- 审计对象：Hub Phase 3 草案（contracts/plan.md §「Hub 草案」）
- 前置：Phase 1（019d2ea）+ Phase 2（d88799a）均已入库；Phase 2 audit = reports/audit-r28p2.md（2 P1 债务）。
- 方法：全部裁决基于当前仓库源码取证（file:line）+ P2 audit 交叉核对。URL 抓取已砍（本轮只文本粘贴）。

## 摘要（TL;DR）

草案方向正确（文本粘贴素材、树级表、hash 去重、进对话/生成上下文），但**最小改动假设有两处证伪**：

1. **[证伪·Q2 核心] "进 discussion/answer 两流的预算第三源"不成立**：answer 流**根本不用 budgetDiscussionContext**——它走 `assembleContext`（answer-service.ts:120），是树段组装器（ancestor-full/summary），**零预算结构**。materials 想进 answer 流不是"扩第三源"，是往一个无预算的独立代码路径塞新东西，改动面远超草案设想。**建议 v1 materials 只进有预算的两个消费点（discussion + synthesis 蒸馏），answer 流暂不进**。
2. **[放大既有债·Q5] materials 会放大 audit P1-2**：extract/retrospective 树级调用**已无总预算**（synthesis-service.ts:162/178 原样 JSON.stringify 全部节点，20 节点最坏 320k 字符）。materials 作为第 N 源叠进去会让这两个已超窗风险的调用雪上加霜。**建议本轮顺手修 P1-2**（材料进 extract/retrospective 前必须先有树级总预算），否则是给爆炸的调用再加燃料。
3. **[术语校正] "第三源"名不副实**：context-budget 现有三源是 `document/thread/digest`（context-budget.ts:1-7），materials 是**第四源**。且它的降级优先级要想清楚（材料该比文档/讨论先被砍还是后砍？）。

其余多数 CONFIRM——树级表、hash upsert、enabled 列、textarea 均合理且有先例。逐条如下。

---

## Q1 — 数据模型：树级 vs 节点级 + enabled 列

**裁决：CONFIRM 树级归属 + enabled 列必要；CHALLENGE "可挂某分支"不做（v1 树级足够，节点级是过度设计）。**

- **树级归属 CONFIRM**：素材是"这次脑暴的背景资料"，天然是**讨论级/树级资产**，不是某节点的产物。树级表有直接先例：syntheses/open_questions/retrospectives 均 `tree_id` 归属（schema.sql:154/171/184，synthesis-repo.ts:18/22）。`materials(id, tree_id, title, content, content_hash, created_at)` 与它们同构。
- **节点级归属（"可挂某分支"）CHALLENGE 不做**：
  - Q1 自问"材料是讨论级资产还是可挂某分支"。**证据倾向树级**：R20 实证讨论是线性的（15 父 10 单子），"把资料挂到特定分支"是**假设的高级用法，无使用证据**。
  - 节点级会引入"资料随节点软删/移动如何处理"的复杂度（对照 discussion_messages 挂 node 的软删问题）。
  - **v1 树级，节点级留 v2**（若真出现"这份资料只跟这个分支相关"的需求）。加节点级 = 过度设计门禁触发。
- **enabled/disabled 列 CONFIRM 必要**：
  - "禁用=不进上下文但保留"是**真实需求**——粘了 5 份资料，某次讨论只想让 2 份进上下文（省 token + 聚焦）。删了要重粘，禁用可切回。
  - 低成本（一个 `enabled INTEGER NOT NULL DEFAULT 1` 列 + 查询过滤），与 document_shares 的 `is_enabled`（schema.sql:132）同模式。
  - **但要定义默认**：新建默认 enabled=1（进上下文）。

> CONFIRM 树级 + enabled 列（默认 1）；CHALLENGE 节点级归属 v1 不做（无使用证据，过度设计）。表形状：`materials(id, tree_id, title, content, content_hash, enabled, created_at)`，schema.sql 追加 CREATE TABLE IF NOT EXISTS（tree_folders:1-4 先例，无需 PRAGMA）。

---

## Q2 — 上下文接线：进哪些流 + context-budget 怎么扩

**裁决：CHALLENGE 草案"discussion/answer 两流"——answer 流无预算结构，v1 不进；干净扩法 = budgetDiscussionContext 加第四源，只惠及 discussion + synthesis 蒸馏。**

### 各流该不该进（逐个取证）
- **discussion（讨论条）：进**。assembleDiscussionContext（discussion-service.ts:116-127）已用 budgetDiscussionContext 三源，加材料源自然。这是 materials 最主要的价值点（脑暴时引用资料）。
- **answer（生成）：v1 不进（证伪草案）**。**实证：answer 流不用 budgetDiscussionContext**——answer-service.ts:120 用 `assembleContext(deps, nodeId, userInput)`（assemble.ts 的树段组装：ancestor-full/summary/annotation-seed/merged-conclusion），**完全独立的无预算路径**。草案说"进 discussion/answer 两流的预算第三源"——answer 流没有那个"预算第三源"可扩。往 answer 塞材料要么改 assembleContext（动树段组装核心，风险高），要么在 answer 前另拼——**都不是"扩第三源"的最小改动**。**建议 v1 answer 不进**，materials 主场是 discussion。
- **synthesis 蒸馏（逐节点）：草案说不进（v1）——CONFIRM**。逐节点蒸馏是"提取本节点主张"（synthesis-service.ts:123），材料是树级背景，混进单节点蒸馏语义不符 + 放大每节点 token。不进对。
- **synthesis 综合阶段：UNCERTAIN，倾向不进 v1**。综合阶段吃的是节点蒸馏产物（synthesis-service.ts:141），材料若要影响成文，更适合作为"背景"章节的输入——但 v1 草案说蒸馏不进，综合阶段同理暂不进，避免放大综合输入。
- **extract / retrospective：进则必须先修 P1-2（见 Q5）**。这两个树级调用无预算（synthesis-service.ts:162/178），材料进去直接放大超窗风险。

### context-budget 最干净扩法
- 现结构（context-budget.ts:58-88）：泛型 `budgetDiscussionContext({document, thread, digest}, overrides)`，三源各配额 + 逐源降级（trimDocument/trimThread/trimDigest）+ 共享帽 totalChars。
- **加第四源 materials 的最干净路径**：
  - DEFAULT_CONTEXT_BUDGET 加 `materialChars`（context-budget.ts:1-7）。
  - 入参加 `materials: Array<{content}>`，加 trimMaterials（仿 trimThread context-budget.ts:26-38，超限丢弃低优先材料）。
  - 降级序列（context-budget.ts:81 现为 `['thread','digest','document']`）要决定 materials 插哪——见 Q3。
- **只惠及 budgetDiscussionContext 的两个真实消费点**：discussion-service.ts:117、synthesis-service.ts:54（后者是蒸馏，v1 不加材料，所以传空）。**即 v1 实际只有 discussion 流用到材料源**。

> CHALLENGE 草案两流：answer 流无预算结构（assembleContext 独立路径 answer-service.ts:120），v1 不进；干净扩法 = budgetDiscussionContext 加第四源 materialChars + trimMaterials，v1 实际只 discussion 流受益。synthesis 蒸馏/综合不进（v1）；extract/retro 进则先修 P1-2。

---

## Q3 — 容量门禁

**裁决：CONFIRM 需要单条+每树+预算占比三重门禁；CHALLENGE materials 应独立第四源配额（不挤占文档/讨论），降级优先级材料先砍。**

- **单条字数上限**：文本粘贴无上限会撑爆。document-content.ts:5 有 `MAX_DOCUMENT_BYTES = 2MB` 先例，但材料该更小（材料是"参考片段"非"整本书"）。**建议单条上限 ~10k 字符**（对齐 Phase 3 验收锚"10k 字素材" docs:71），超限**拒绝 + 提示**（不静默截断——截断的资料是坏资料，用户不知道被砍了）。
- **每树上限**：防粘 50 份。**建议每树 ~20 条或总量帽**（如全部材料合计 ≤50k 字符），超限拒绝新增 + 提示先删/禁用。
- **预算占比（关键裁决）**：materials **应是独立第四源配额，不挤占文档/讨论**。
  - 理由：文档全文和讨论线程是"当前正在做的事"，材料是"参考背景"。若材料挤占文档配额（context-budget.ts 共享帽 totalChars），粘一份大资料会把**正文挤出上下文**——本末倒置。
  - **建议**：materialChars 独立配额（如 3000-4000，小于 document 8000/thread 6000），totalChars 相应上调；共享帽紧张时**材料最先被砍**（它是背景，可牺牲）。
  - 降级序列建议改为 `['materials', 'thread', 'digest', 'document']`（context-budget.ts:81 现为 thread/digest/document）——材料排最前（最先牺牲），文档排最后（最后牺牲）。**这个顺序体现"正文 > 讨论 > 分支摘要 > 背景材料"的优先级**。
- **超限行为**：单条/每树上限=**拒绝+提示**（用户可感知可操作）；上下文预算内=**逐源降级截断**（材料先砍，透明标注 truncated，复用 context-budget.ts:65 的 truncated 数组机制）。

> CONFIRM 三重门禁；CHALLENGE：materials 独立第四源配额（不挤占正文/讨论），降级序列材料最先砍（`['materials','thread','digest','document']`）；单条/每树超限拒绝+提示，预算内逐源截断标注。

---

## Q4 — UI 入口

**裁决：CONFIRM 树级材料区；CHALLENGE 放置——SynthesisPanel 加 tab 语义不符，建议独立树级区或与 SynthesisPanel 并列；textarea 足够（不复用 markdown 编辑器）。**

- **放置**：
  - **SynthesisPanel 加第五 tab CHALLENGE**：SynthesisPanel 是"成文/经营"的产物面（成文/开放问题/回顾）。材料是**输入**不是产物，塞进产物面板语义错位。且 SynthesisPanel 挂在 MainDoc（node 级 `key={node.tree_id}` MainDoc.tsx:985 区域），材料是树级——概念层级也不完全对。
  - **TreeLauncher 层 CHALLENGE**：TreeLauncher 是笔记库入口（选哪个库），材料是库内资产，放这层太靠外。
  - **建议**：材料区作为**树级独立区**，与 SynthesisPanel 同层（都是树级功能面），或 SynthesisPanel 若已是树级容器则加"材料"区块（不是与成文/回顾并列的 tab，而是独立分区）。**关键是概念上"材料=树级输入"要与"成文=树级产物"区分开**。具体挂点建议 coder 契约里由 web 侧定，plan 只裁决"不塞进成文 tab"。
- **编辑器形态**：**textarea 足够，不复用 markdown 编辑器（CHALLENGE 复用）**。
  - 材料是"粘贴参考文本"，不需要富文本编辑（不需要 CodeMirror/ProseMirror 的语法高亮/结构编辑）。
  - 复用 markdown 编辑器（MarkdownEditor）= 引入重组件 + R26 反复咬的编辑器/保存/hydrate 复杂度，为一个"粘文本"场景严重过度。
  - **textarea + 字数计数 + 保存**足够。与 discussion 输入（DiscussionStrip 的 textarea 类输入）同量级。

> CONFIRM 树级材料区；CHALLENGE 放置（不进成文 tab，作树级独立区/分区，与产物面区分）+ 编辑器（textarea 足够，不复用 markdown 编辑器=避免 R26 编辑器复杂度）。

---

## Q5 — P1-2 顺手修（extract/retrospective 无总预算）

**裁决：CHALLENGE——本轮必须一并修。materials 进 extract/retrospective 会直接放大已超窗的调用，不修则是给爆炸加燃料。**

- **P1-2 实证**（audit 已记，我复核）：
  - `extractQuestions`（synthesis-service.ts:159-162）：`nodes.map(({id, document, thread}))` 全量送，每节点 document≤8000+thread≤6000（budgetDiscussionContext 单节点帽，synthesis-service.ts:54），**× N 节点无总预算**。20 节点最坏 ~320k 字符（audit P1-2）。
  - `retrospective`（synthesis-service.ts:171-178）：`recentDiscussion: input.nodes.map(({id, thread}))` 每节点≤6000 × N + skeleton + merges，20 节点 ~120k+。
  - provider 层不截断（audit 已确认 codex/anthropic-provider 不 slice 输入）。
- **materials 的放大效应**：若草案让 materials 进 extract/retrospective（Q2 说"各自该不该进"待裁决），materials 是第 N 源叠加——**本已 320k 的调用再加材料 = 更确定超窗**。
- **裁决：本轮修 P1-2 是前提**：
  - **修法建议**（复用 context-budget 逐源降级思路，audit 也这么建议）：给树级调用加**总预算 clamp**——按节点数缩放每节点配额（节点越多每节点配额越小），或对整个树级 payload 设总字符帽（如 60k），超限**逐节点降级**（丢弃最旧/最深节点的 thread，保 skeleton + document 摘要）。
  - **具体**：新增 `budgetTreeContext(nodes, materials, treeBudget)` 或把 budgetDiscussionContext 泛化——但 audit P1-1 已警告"别再造第 N 份重复实现"，所以**优先泛化 context-budget 而非新写一套**：让它接受"多节点数组 + 总帽"，逐节点分配 + 逐源降级。
  - materials 作为树级源纳入这个总预算（与节点内容一起 clamp）。
- **若不修的风险**：owner 用大树（购物车心理学 20+ 节点，单节点 4000 字符）点抽取/回顾/带材料 → 数十至上百 k → 400/502 或默默烧超量 token。这正是 owner 会遇到的真实场景。

> CHALLENGE：本轮必须修 P1-2（materials 放大它）。修法 = 泛化 context-budget 加树级总预算 clamp（按节点数缩放配额 + 逐源降级），materials 纳入该总预算。不修则 materials 是给超窗调用加燃料。这是 Phase 3 与 P1-2 的强耦合，不能分开。

---

## Q6 — 更新语义

**裁决：CONFIRM hash upsert 去重；CHALLENGE 编辑=新 hash 原地更新（不新行）；删除对成文脚注影响需定义（材料不进脚注，影响小）。**

- **同 hash upsert 去重 CONFIRM**：粘同样内容不重复入库。content_hash 去重有先例（synthesis cacheKey digest synthesis-service.ts:56、open_questions UNIQUE synthesis-service.ts:166）。
- **编辑材料内容**：
  - **CHALLENGE "新 hash 新行"**：材料是**可编辑资产**（改错别字、补内容），不是版本化历史。新 hash 就新行会**累积垃圾**（改 3 次留 3 行）。
  - **建议原地更新**：编辑 = UPDATE 同 id 的 content + content_hash + 不改 created_at（或加 updated_at）。材料**不需要版本历史**（不是 node_versions 那种需回溯的东西）。
  - hash 的作用是**去重（新增时查重）**，不是版本键。编辑走 id 更新，新增走 hash 查重。
- **删除对已生成内容的影响**：
  - Q6 问"删除对成文脚注的影响"。**关键**：材料**不进成文脚注**（脚注是节点血缘 `[^n]→nodeId`，synthesis-service.ts:62/64/153，材料不是节点）。所以删材料**不影响已生成成文的脚注**。
  - 但材料若进了 discussion 上下文并被"沉淀"进正文——那部分已是 document_content 的文本，删材料不影响（已固化）。
  - **结论：删材料是安全的**（不级联影响任何已生成产物），可硬删或软删。**建议软删/或直接硬删**（材料无引用完整性依赖，比节点简单）。enabled=0 已提供"保留不用"，删除就是真删。

> CONFIRM hash upsert（新增查重）；CHALLENGE 编辑走 id 原地更新（不新行，材料非版本化资产），加 updated_at；删除安全（材料不进脚注/无引用依赖），硬删即可，enabled=0 覆盖"留而不用"。

---

## Q7 — 最小改动假设逐条证伪

**裁决：①CONFIRM（无迁移外 schema 变更）②CONFIRM（client 加 CRUD）③CONFIRM（不进 node_versions/分享）——三条均成立，但 Q2/Q5 的接线改动不止这些。**

- **①materials 不需要迁移之外的 schema 变更 —— CONFIRM**：新表 `CREATE TABLE IF NOT EXISTS materials`（tree_folders/syntheses 先例 schema.sql:1/154），connection.ts 无需列迁移（新表非改旧表）。**成立**。
- **②client 只加 CRUD 方法 —— CONFIRM（前端 API 层）**：client.ts 加 listMaterials/createMaterial/updateMaterial/deleteMaterial（setTreeFolder 形状先例 client.ts）。**成立**——但注意这只是 API 层；**Q2 的上下文接线（budgetDiscussionContext 加第四源 + discussion-service 拼装）是 client CRUD 之外的服务端改动**，不在"client 只加 CRUD"覆盖内。假设本身对，但别误以为前端 CRUD = 全部工作。
- **③材料不进 node_versions / 分享链路 —— CONFIRM**：
  - node_versions 是节点内容版本（schema.sql:86），材料是树级独立资产，**不进**——对（材料无版本化需求 Q6）。
  - 分享链路：share-renderer 渲染 node 树的 documentContentOf（share-renderer.ts:36-39/114），材料**默认不进分享**——对，且**应当不进**（材料是私有参考背景，分享给外人看的是成文/文档，不是你的原始资料）。**成立且正确**。
- **未被假设覆盖的真实改动面**（补充，非证伪）：
  - context-budget.ts 加第四源（Q2）——服务端核心改动。
  - discussion-service.ts assembleDiscussionContext 拼材料源（discussion-service.ts:116-127）。
  - **P1-2 修复**（Q5）——若 materials 进 extract/retrospective。
  - deps.ts wiring（materials repo + service，deps.ts:74-89 模式）+ app.ts registerMaterialRoutes + 新 routes/materials.ts + repo/material-repo.ts。

> ①②③ 三条最小改动假设**均 CONFIRM**，但要清醒：真正的改动重心在 Q2（budget 第四源）+ Q5（P1-2 修复）+ 服务端 wiring，不是"加个表加个 CRUD"那么轻。materials 的 CRUD 是易的，**上下文接线与预算才是本轮实质**。

---

## 实现设计缺陷/裁决清单（分级）

| 级别 | 项 | 证据 | 处置 |
|---|---|---|---|
| **CHALLENGE(核心)** | answer 流无预算结构，materials 进不去"第三源" | answer-service.ts:120 用 assembleContext 非 budgetDiscussionContext | v1 answer 不进；materials 只进 discussion（+ 预算第四源） |
| **CHALLENGE(耦合)** | materials 放大 audit P1-2（extract/retro 无总预算） | synthesis-service.ts:162/178 全量 JSON.stringify | 本轮必须先修 P1-2（树级总预算 clamp） |
| CHALLENGE | 术语：materials 是第四源非第三 | context-budget.ts:1-7 已有三源 | 加 materialChars + trimMaterials，降级最先砍 |
| CHALLENGE | 编辑新行会累积垃圾 | 材料非版本化资产 | 原地 id 更新 + updated_at |
| CHALLENGE | SynthesisPanel tab 语义错位 | SynthesisPanel 是产物面 | 材料作树级输入独立区 |
| CHALLENGE | 复用 markdown 编辑器过度 | R26 编辑器复杂度 | textarea 足够 |
| CONFIRM | 树级表 + enabled 列 | syntheses/open_questions 先例 | 按草案做 |
| CONFIRM | hash upsert 去重 | synthesis cacheKey/open_questions UNIQUE | 新增查重 |
| CONFIRM | 不进 node_versions/分享 | 材料是私有背景 | 按草案做 |
| CONFIRM | 无迁移外 schema 变更 | 新表 IF NOT EXISTS | 按草案做 |

---

## 给 Hub 的结论

草案方向对，但**实质工作不在"加表+CRUD"，在上下文接线与预算**。放行 coder 前建议：

1. **[核心·Q2] v1 materials 只进 discussion 流**——answer 流走 assembleContext（answer-service.ts:120）无预算结构，塞材料改动面大且风险高，v1 不进。context-budget 加第四源 materialChars + trimMaterials。
2. **[强耦合·Q5] 本轮必须先修 audit P1-2**——extract/retrospective 树级调用无总预算（synthesis-service.ts:162/178），materials 会放大到确定超窗。泛化 context-budget 加树级总预算 clamp（别新写第 N 份，audit P1-1 教训），materials 纳入该总预算。
3. **[Q3] materials 独立第四源配额**（不挤占正文/讨论），降级序列材料最先砍（`['materials','thread','digest','document']`）；单条 ~10k / 每树总量帽，超限拒绝+提示。
4. **[Q1/Q6] 树级 + enabled(默认1) + 编辑原地更新**（非新行）；节点级归属 v1 不做（过度设计）。
5. **[Q4] textarea（非 markdown 编辑器）+ 树级独立区（非成文 tab）**。
6. **[Q7] 三条最小改动假设成立**，但真正重心是服务端 budget/接线 + P1-2 修复。

**停止条件**：草案在 context-budget 上无硬冲突（第四源可承载，泛型结构 context-budget.ts:58 支持扩展）——按契约"报告说明即可，不 blocker"。本轮零代码改动（本报告）。

契约拆分建议：server（materials 表/repo/route + context-budget 第四源 + P1-2 树级预算 clamp + deps/app wiring）+ web（materials 树级区 textarea + client CRUD）。**P1-2 修复应在 server 契约内与 materials 同轮**，因两者在 context-budget 同一处收口，分开做会改两次。
