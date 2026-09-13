# Round 28 · plan 全面反证审计：脑暴工作台（P0–P5 完整方案）

- 日期：2026-09-13
- 角色：plan（重型产品+技术反证，只读，零生产代码改动）
- 审计对象：Hub 六件套方案 P0–P5（contracts/plan.md §「Hub 方案草案」）
- 方法：全部裁决基于当前仓库源码取证（file:line）+ 历史裁决引用（state/TASK.md 条目，R16/R17/R20/R21 详报已不在盘，仅存 TASK.md 摘要，契约已许可此引用方式）。子系统侦察含 2 个 Explore 子代理（内容管道 / route+share），关键结论均由我独立 file:line 复核。

## 摘要（TL;DR）

方案总体**方向正确**且切中 R20 实证痛点（线性讨论、树机制错位、merge 重复、tags/visual 零用）。总架构洞察（P0–P4 共享"上下文引擎的多种组装"）**成立**——现有 context-engine 的四段型（ancestor-full/summary/annotation-seed/merged-conclusion，types.ts:18-21）正是这个复用地基的实锤。但发现 **1 个可能改变分期的地雷 + 3 个事实校正 + 4 个该砍/该降级项**：

1. **[地雷·可能触发 stop condition]** P0"沉淀为正文小节"和 P2"成文"都写 `document_content`，而**保存路径内嵌 `hydrateNode`（document-content.ts:109）——R26 读即覆写地雷就在这条路上**，且用 `baseRevision` 乐观并发（document-content.ts:89/116/138，冲突 409）。服务端改写 + 客户端并发编辑会 409 碰撞或互相覆盖。**这不必然要求先做 Phase B（四表示收敛），但 P0/P2 的写盘契约必须显式复用 document-content 保存管线的 baseRevision+hydrate 守卫，不能新开第二条写 document_content 的路**——否则重演 R26。详见 Q3。
2. **[事实校正·Q10]** 契约称"智能路由 route-convergence 未接线"——**错**。route-convergence **已全链路接线且对用户可见**：parallel-ask.ts:30-38 每次回答并行调 `api.route()`，MainDoc.tsx:407 `runRoutedAnswer` + RoutePrompt UI（MainDoc.tsx:36/118/462）。P0/P3 必须在"已有活路由"的前提上设计，不是"顺势接线"。
3. **[事实校正·Q10]** 分享管线**复用 normalizeMarkdown**（share-renderer.ts:5/165）且只渲染 `documentContentOf(node)`（share-renderer.ts:114/177/193）——新 discussion_messages 层**默认在分享中不可见**（P0 scope-out 正确），但 **P2 成文产物若要可分享，必须落进 document_content 或节点体，不能只存讨论表**。
4. **[该砍/降级]** P3 素材导入（URL 抓取+SSRF）是**当前代码零先例的净新攻击面**（全仓库无用户导向的 outbound fetch，仅 provider 打 baseUrl），且 R20 实证此类需求近零——**建议 P3 素材导入降级/砍到最后或砍掉**，只保留 P3 的跨分支 digest（那个是 P0/P1 质量放大器，反而该提前）。

逐条裁决如下。

---

## Q1 — 对话层数据模型 + 沉淀语义

**裁决：CONFIRM discussion_messages 独立表（不复用 nodes）；CHALLENGE 沉淀只有两动作——遗漏"替换/纠正正文"，且与既有 ChatBox/route 的 UX 关系需澄清。**

### 独立表 vs 复用 nodes：CONFIRM 独立表
- 复用 `nodes(status='chat')` 会**直接重演 R20 的树膨胀**（15 父节点 10 单子=线性，树被当对话用）。Hub 的"树=结晶产物、讨论=前厅"分层**正确**，独立表是唯一能既存讨论又不污染树的方式。
- 独立表迁移零风险：新表纯 `CREATE TABLE IF NOT EXISTS`（tree_folders:1-4 是 R22 先例，schema.sql 全表此模式，**无需 PRAGMA 列探测**——那是给旧表加列用的 connection.ts:38-43）。
- **但外键要对齐软删**：`discussion_messages.node_id REFERENCES nodes(id)`——nodes 是软删（is_deleted，schema.sql:25）。讨论消息挂在软删节点上时的可见性/级联要定义（建议：随节点软删而在查询层过滤，不硬删，与 annotations 同纪律 schema.sql:47）。

### 沉淀语义：CHALLENGE——遗漏第三动作
- 草案两动作：①追加为正文小节 ②转为子文档。**遗漏"替换/纠正正文"**：脑暴常见结局是"讨论后发现正文某段错了，要改它"，而非"追加"。这正是 R18 纠正性合并（correct-service）解决的语义。**建议第三动作 = 复用 correct-service 的 patch 模式**（讨论线程 → assembleForCorrection 风格 → diff 预览 → 采纳才写，correct-service.ts:100-111）。不新做，接线既有 correct 管线。
- **两动作的 promoted 双字段够不够**：`promoted_node_id + promoted_mode` 记录"这轮沉淀成了什么"——对"追加"和"转子文档"够。但"追加"沉淀到的是 document_content 的某一段，**promoted_node_id 指向本节点自身、mode='append' 无法定位追加到哪一段**（无 segment/anchor 引用）。若日后要"撤销这次追加"，双字段不足。**建议**：mode 加 'correct'；append 场景记 version_no（沉淀时的版本快照号，node_versions 已有 version_no schema.sql:76）作可回退锚，而非只记 node_id。

### UX 关系澄清（重要，非阻塞）
- **已有 ChatBox 是主 composer**（ChatBox.tsx:58-64 `onSubmit(question)` → 创建树节点/生成答案）。P0 的"讨论条"是**第二个输入面**。用户何时用 ChatBox（长出树节点）vs 讨论条（不进树）？**边界不清会造成"我该在哪打字"的困惑**。建议终稿给 owner 一句话区分："ChatBox=开新探索分支（进树）；讨论条=就这篇文档追问（不进树，除非沉淀）"。
- **已有 route-convergence**（Q10）：ChatBox 提问后会弹路由提示（挂到主线/子文档/新分支）。讨论条**不应触发路由**（它本就是"不进树"）——设计要显式让讨论条走**无路由**的轻量生成路径，否则每条讨论都弹路由提示=摩擦。

> CONFIRM 独立表（补软删对齐）；CHALLENGE 两动作（补第三动作"纠正"复用 correct-service，append 记 version_no 可回退）；澄清与 ChatBox/route 的 UX 边界，讨论条走无路由轻量路径。

---

## Q2 — token 预算架构

**裁决：CHALLENGE——现有 ancestor-depth/summary 先例是**单链**预算，P0-P3 的"文档全文+线程+digest+素材"是**多源叠加**，先例不够，必须建统一预算管理器。**

- 现有预算机制是**单链祖先**：`build-branch-segments.ts:30-40` 的 `context.ancestorFullDepth`（默认 2）——距父 N 层内全文、更早转 `ancestorDigest` 启发式摘要（build-branch-segments.ts:47-53，问题首行+答案前 200 字）。这是**一维链**（祖先路径）的预算。
- P0-P3 的上下文是**多源叠加**：文档全文 + 最近 N 轮线程（滚动）+ 树 digest（P3）+ 素材（P3）。这四源**各自增长且无统一上限**——长文档（document_content 可达 2MB，document-content.ts:5 MAX_DOCUMENT_BYTES）+ 长线程 + 大 digest 同时注入 → **token 爆炸**。先例只管祖先链，管不了这四源叠加。
- **必须建预算管理器**，形状建议（复用现有启发式，不上 tokenizer）：
  - 各源**独立预算配额**（文档 X / 线程 Y / digest Z / 素材 W），总和有硬顶。
  - 超配额时**逐源降级**：文档全文→文档摘要（复用 ancestorDigest 风格 build-branch-segments.ts:47）；线程滚动窗口（最近 N 轮，草案已提）；digest 本就是摘要；素材长文摘要后入（草案已提）。
  - 配额走 settings（复用 context.ancestorFullDepth 的 settings 透传先例 build-branch-segments.ts:31-40），owner 可调。
- **反对**："token 预算"不该是每个 move/成文各自拍脑袋的常量（草案 P1"每 move 独立 token 预算"），应是**统一管理器按源分配**，否则四源在某个 move 里同时满载就炸。
- **不上 tokenizer**：字符数近似（现有 SUMMARY_ANSWER_LEAD=200 就是字符预算 build-branch-segments.ts:33）够用，别引 tiktoken 依赖。

> CHALLENGE：先例是单链预算，多源叠加会炸。必须建统一预算管理器（按源配额+逐源降级+硬顶），复用 ancestorDigest 摘要器与 settings 透传，不上 tokenizer。这是 P0-P3 共同地基，应在 Phase 1 就立住骨架。

---

## Q3 — 沉淀改 document_content 与 R26 修复的冲突面

**裁决：CHALLENGE——这是全案最大技术地雷。P0 沉淀 + P2 成文都写 document_content，保存路径内嵌 hydrateNode（R26 读即覆写现场）+ baseRevision 乐观并发。必须复用既有保存管线，禁开第二条写路。**

实证冲突面：
- **保存路径内嵌 hydrateNode**：document-content.ts:108-109 —— `const existing = found?.file_path ? app.deps.vault.hydrateNode(found) : found`。**R26 的读即覆写地雷（hydrateNode 从 vault 文件回灌 DB）就在保存入口**。R26 已加 hash+mtime 双守卫（TASK.md #33），但那是针对"读"路径；服务端**主动改写** document_content 时，若 vault 文件与 DB 不同步，hydrate 可能先用旧文件覆盖再被新内容写——顺序敏感。
- **baseRevision 乐观并发**：document-content.ts:89（校验 baseRevision）→ :116-117 `updateDocumentContent({baseRevision})` → :138-146 冲突返 **409 content conflict**。含义：**服务端沉淀改 document_content 时，客户端正在编辑该文档持有的是旧 baseRevision → 客户端保存必然 409**（或服务端沉淀用了旧 revision 被拒）。
- **格式契约**：document_content 是 schema 1（PM JSON）或 schema 2（原生 markdown source），consumer markdown.ts 按 schema 分支（R26 加了 doc 形状容忍+转换失败空串，TASK.md #34）。P0 沉淀"AI 改写成 prose 追加"——**追加产物必须是合法的当前 schema**，PM JSON 追加要拼进 doc.content 数组（answerToProseMirror 先例 answer-service.ts:32-44），原生 markdown 追加要拼字符串。混错 schema = 重演 R26 裸 JSON。

**裁决要求（coder 契约必须写死）**：
1. **P0 沉淀/P2 成文写 document_content 必须走 `updateDocumentContent` 同一入口**（node-repo.ts:138-165），带 baseRevision，**不新开第二条写 document_content 的 SQL**（否则绕过并发守卫=R26 复发）。
2. **服务端改写与客户端编辑的并发**：沉淀应**读当前 revision → 基于它改 → 带 revision 写**，冲突则 409 让前端刷新重试（复用现有 409 通路 document-content.ts:139-146）。**不能盲写**。
3. **追加产物 schema 对齐**：必须匹配目标文档当前 schema（1 或 2），复用 answerToProseMirror（schema 1）或字符串拼接（schema 2）；写后同步 vault（复用 writeNode document-content.ts:124）+ 版本快照（snapshotEditSession document-content.ts:127）。
4. **不触发 stop condition 的前提**：以上复用成立时，**不需要先做 Phase B 四表示收敛**。但**若 coder 发现沉淀无法复用 updateDocumentContent（例如追加需要 anchor 级插入而现管线只整体替换）→ blocker**，那才可能要动保存管线。

> CHALLENGE：R26 地雷在保存路径上。裁决：P0/P2 写 document_content 强制复用 updateDocumentContent+baseRevision+hydrate 守卫+writeNode+快照，禁第二条写路；服务端改写走"读 revision→改→带 revision 写→409 重试"。这是**避免重演近失事故**的硬约束，非可选。

---

## Q4 — 成文合成的规模与质量

**裁决：CONFIRM 逐节点蒸馏（非逐分支，R17 实证支持）；CHALLENGE 成本与呈现——20+ 节点逐个 provider 调用是重操作，"讨论总结"放树内新节点会污染树。**

### 逐节点 vs 逐分支：CONFIRM 逐节点
- R17 实证（TASK.md #91 Decisions）：**逐分支蒸馏比双峰**——小分支**负蒸馏 3.5-11×**（101ch 正文→350ch 结论，且是父节点内容回声；6ch→66ch），大分支才真压缩（0.17-0.33×）。所以"逐分支"对小分支是**放大不是压缩**。Hub 的"逐节点蒸馏"避开这个坑——**CONFIRM**。
- **但要防"祖先回声"**（R17 核心发现，TASK.md #91）：merge 输入含父全文时，LLM 把父的内容总结回父。成文蒸馏 prompt 必须加"不复述已在其他节点出现的内容"，否则 20 节点蒸馏出 20 段互相重复。

### 成本：CHALLENGE
- 真实树 20+ 节点 × 每节点 1 次 provider.complete（merge-service.ts:43 先例）= **20+ 次串行 LLM 调用**。glm-5.3 每次数秒 → 成文一次 **1-2 分钟**。这是重操作。
- **建议**：①成文**异步 + 进度反馈**（复用 R25 SSE 心跳 answer.ts:57，否则又是"生成中"卡死 R25 场景重演）；②**并发蒸馏有上限**（别 20 个并发打爆 provider，2-3 并发）；③**活总结去抖**（草案已提"沉淀事件后去抖刷新"——但 20 节点重蒸馏每次都 1-2 分钟，去抖窗口要足够大，建议手动触发为主、自动为辅）。

### 呈现与放置：CHALLENGE"讨论总结放树内新节点"
- 草案"产出树级『讨论总结 vN』节点"——**这会污染树**（又多一类非探索节点进 nodes 表，与 P0 独立表避污染的逻辑自相矛盾）。
- **建议**：讨论总结**不进 nodes 树**，作为**树级独立产物**（新表 `tree_summaries(tree_id, version, content, created_at)` 或存 settings/单独表），版本化。理由：它是"树的成文视图"，不是树的一个探索节点。放树内会让 SessionMap（会话地图）多出一个语义不同的节点类型，破坏"树=探索结构"的视觉语义。
- **脚注血缘呈现**：血缘管道已有（GET /api/trees/:id 返回 annotations+merges，TASK.md 边界条）。脚注"来源节点 id"应渲染为**可点击跳转到该节点**（复用 SearchPalette 的跨树跳转先例）。呈现为文末脚注区，不是行内（行内会打断成文阅读）。
- **可分享性**（关联 Q10）：成文产物若要能分享，**必须能进 share-renderer**（现只渲染 documentContentOf，share-renderer.ts:114）——所以成文若存独立表，share-renderer 要显式加读该表的分支，否则成文分享不出去。

> CONFIRM 逐节点（防祖先回声）；CHALLENGE：成本重（异步+SSE 心跳+并发上限+去抖），呈现放树外独立产物（不污染树/SessionMap），脚注可跳转，成文要可分享须接 share-renderer。

---

## Q5 — 跨分支 digest 的时效与否决状态来源

**裁决：CONFIRM digest 段可行（复用 ancestor-summary 机制）；CHALLENGE 否决状态语义未闭环——三个来源（merges 方向/开放问题 resolved/人工标记）会打架。**

- **digest 段可行**：现有 `ancestor-summary` 段型（types.ts:19，build-branch-segments.ts:76-83）就是"启发式摘要注入上下文"的先例。P3"树状态 digest"是它的横向扩展（从祖先链扩到兄弟/他分支）——机制成立，加一个 SegmentType（如 'tree-digest'）即可。
- **否决状态来源：CHALLENGE 未闭环**。草案说否决状态"源自 P4 决策日志+merges 记录"，Q5 又列三个可能来源。**三源会打架**：
  - merges 方向（correct 的 direction，schema.sql:100）：记录"父被子纠正"，但**不等于"某分支被否决"**——纠正是融合不是否决。
  - 开放问题 resolved（P4 open_questions）：resolved 是"问题解决"，也**不等于分支否决**。
  - 人工标记：唯一真正表达"我否决了这个分支"的语义，但草案没给这个入口。
- **建议闭环**：**"否决"需要一个显式的一等公民状态**，不能从 merges/open_questions 反推。要么：①节点加 `verdict` 字段（active/rejected/merged），人工或成文时标；②或复用软删（is_deleted）但语义不同（删=消失，否决=保留但标记）。**推荐 ①**：digest 里"已否决"标记读节点 verdict，而非猜 merges。否则 digest 会把"被纠正的父"误标"否决"，误导后续对话。
- **时效**：digest 是缓存（草案 P4"回顾缓存"同理）。缓存失效触发器要定义：节点内容变、新增分支、人工标否决 → digest 脏。建议**去抖重算 + 树打开时兜底刷新**（复用 P4 断点回顾的缓存机制）。

> CONFIRM digest 段（扩 ancestor-summary）；CHALLENGE 否决状态：三源反推不闭环，需显式 verdict 字段作一等公民，digest 读它而非猜 merges/open_questions。时效走去抖+打开兜底。

---

## Q6 — moves 数据驱动配置 + 三视角连调失败中间态

**裁决：CONFIRM 数据驱动（JSON 配置）；CHALLENGE 三视角连调的失败/中断/成本，需定义中间态。**

- **数据驱动 moves CONFIRM**：move=preset 指令+上下文变体，JSON 配置非代码——对。降低加新 move 的成本，owner 可扩。preset 就是 system 提示模板（answer-service system 消息先例 answer-service.ts:178-185）。
- **三视角连调（三次具名 persona）CHALLENGE**：
  - **失败中间态**：草案 Q6 自问"第 2 个 persona 超时怎么呈现"。三次串行 provider.complete，第 2 次超时（R25 的卡死场景在这里重演风险）——**必须定义部分成功**：已完成的 persona 1 保留展示，persona 2 标"生成失败可重试"，persona 3 不启动或独立重试。**不能整批失败丢弃**（用户等了 2 个成功却因第 3 个失败全没了）。
  - **成本叠加**：三视角=3× 单次成本+延迟。复盘 move="全树摘要+停滞检测"又是全树扫描。**每个 move 的真实成本差异大**，"每 move 独立 token 预算"（草案 P1）不够——要**每 move 独立超时+失败隔离**（复用 R25 watchdog client.ts + heartbeat answer.ts:57）。
  - **流式呈现**：三视角应**逐 persona 流式出**（persona 1 边生成边显示），不是等三个都完再出（否则 30 秒白屏=R25 卡死观感）。
- **建议**：move 执行器统一走"独立 SSE 流 + 每步 watchdog + 部分成功保留"，三视角是其中一个多步 move 的实例。

> CONFIRM 数据驱动；CHALLENGE 多步 move（三视角/复盘）需：部分成功保留、每步独立超时+失败隔离、逐步流式（复用 R25 心跳/watchdog），否则重演卡死。

---

## Q7 — P5 CJK 等宽字体选型 + 检测算法

**裁决：CHALLENGE webfont 方案（体积/加载）；推荐系统 CJK 等宽栈优先，检测算法要防误判且作用域收窄。**

- **根因实锤**：`--mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace`（Workbench.css:72）**无 CJK 等宽字体**。中文落到 PingFang（proportional）→ R21 实测西文 7.828px/中文 13px = 1.66 而非 2.00，ASCII 框图必错位（TASK.md #64/R21）。`--mono` 用在 ~8 处（Workbench.css:1315/1329/1526/1664 等）。
- **字体选型 CHALLENGE**：
  - **Sarasa Mono SC webfont 子集**：视觉最佳（真 CJK 等宽），但**体积大**——即使子集化，CJK 字体子集仍达数百 KB-MB。R20 刚为 shiki 懒加载精打细算（+6.2KB 首屏，TASK.md #45），引一个大 webfont 是**开倒车**。且要处理 FOUT/加载失败。
  - **系统 CJK 等宽栈**：`"Sarasa Mono SC", "Noto Sans Mono CJK SC", "Source Han Mono SC", "MS Gothic", monospace` ——**优先系统已装的**，无网络成本。缺点：用户没装则仍回退（但比现状好，至少列了 CJK 等宽候选）。
  - **推荐**：**系统栈优先 + 可选 webfont 兜底**（默认不加载 webfont，owner 明确要求"完美对齐"时才按需拉子集）。首选零成本改字体栈。
- **检测算法 CHALLENGE 误判**：草案"检测围栏内框线字符（┌─│└）→ 切 CJK 等宽"。
  - **误判风险**：普通代码块（TypeScript）里若有注释画的框线，也会被切字体——但这**无害**（代码块切 CJK 等宽不影响西文对齐，CJK 等宽对西文也是等宽）。真正要防的是**性能**：每个代码块扫描框线字符，长文档多代码块 = O(n) 扫描。建议**仅对含框线字符的块加 class**，且扫描在渲染时一次性（复用 R8 的 cm-code-line O(n) 仅 docChanged 先例 TASK.md #31）。
  - **作用域收窄**：只改**代码块内**的字体（`.doc-body pre.has-box-drawing`），**不碰行内 code 和其他 --mono 用途**（SearchPalette/canvas-editor 等 Workbench.css:1526/1664），避免全站字体漂移。
- **保护区**：R8/R10 的 pre/code 几何（Workbench.css 1285-1312，R20 验收 TASK.md #45）——切字体栈**只改 font-family，不动 font-size/line-height/padding**，否则破坏验收过的几何。

> CHALLENGE webfont；推荐系统 CJK 等宽栈优先（零成本）+ 可选按需 webfont；检测只给含框线的代码块加 class（一次性扫描），作用域限 `pre`，不碰行内 code/其他 --mono，不动 R8 几何。

---

## Q8 — 分期顺序（尤其 P3 是否应提前）

**裁决：CHALLENGE 现分期——P3 的"跨分支 digest"应提前到 Phase 1，P3 的"素材导入"应后置/砍；P5 CJK 应提前（独立且是现存痛点）。**

- 现分期：Phase1(P0+P1) → Phase2(P2+P4) → Phase3(P3) → Phase4(P5)。
- **P3 拆开看**：
  - **跨分支 digest**：Q8 自问"是否应提前"——**应该**。它是 P0/P1 对话质量的**放大器**（讨论时能看到别的分支结论，才不会绕圈——正是 R20 "线性讨论"痛点的解）。放 Phase 3 意味着 Phase 1 的对话是"瞎子对话"（看不到树的其他部分）。**建议 digest 提到 Phase 1**（P0 上下文里就该有树 digest，草案 P0 自己也写了"树 digest（P3 后增强）"——承认了依赖）。
  - **素材导入（URL+SSRF）**：**该后置或砍**（见 Q9）。零先例攻击面 + R20 零需求信号。
- **P5 拆开看**：
  - **CJK 等宽**：是**现存痛点**（owner 2026-09-02 唯一真实使用就撞上了，TASK.md #64），且**独立于 P0-P4**（纯渲染层）。**建议提前到 Phase 1 并行**（甚至先做——它是"让现有文档能看"的止血，不依赖任何脑暴功能）。
  - **导出（.md 下载+分享）**：vault 已有 .md（TASK.md），分享已有管线（share-renderer）。**低成本，可任意期**。
- **修正分期建议**：
  - **Phase 1**：P0 对话层 + 跨分支 digest（P3 拆出）+ CJK 等宽（P5 拆出）+ 统一 token 预算骨架（Q2）。=最小可用且质量不瞎。
  - **Phase 2**：P1 脑暴 moves（骑在 P0+digest 上，此时 move 能用 digest）+ P2 成文 + P4 讨论经营。
  - **Phase 3**：P5 导出增强 + 素材导入（若不砍）。
- 理由：**质量地基（digest）和止血（CJK）不该排在功能后面**。草案把 digest 排 Phase 3 是"先做功能再补质量"，但 digest 是 P0 对话不绕圈的前提。

> CHALLENGE：digest 提到 Phase 1（P0 对话的质量前提，草案自己承认依赖）；CJK 提到 Phase 1（现存痛点+独立止血）；素材导入后置/砍。token 预算骨架 Phase 1 立住。

---

## Q9 — 全案该砍什么

**裁决：建议砍/降级 3 项——P3 素材导入、P4 断点续脑暴、P5 飞书推送（草案已延后，确认砍 v1）。**

过度设计门禁（owner 说全要，但 R20 实证零用的功能不该重做）：

1. **P3 素材导入（URL 抓取+SSRF）——建议砍或降到最末**：
   - **净新攻击面**：全仓库**零用户导向 outbound fetch**（仅 provider 打配置的 baseUrl）。URL 抓取要新引 SSRF 防护（私网黑名单/大小上限/超时）——这是**全新安全维护负担**。
   - **R20 零需求信号**：owner 真实使用是线性讨论，没有"导入外部资料"的行为证据。
   - **替代**：owner 要引用资料，可直接粘贴文本（P3 的 text 类型材料够）。**URL 抓取砍掉，只留 text 素材**（粘贴纯文本入上下文，零攻击面）。
2. **P4 断点续脑暴（>X 天 AI 回顾）——建议降级**：
   - R20 实证节点创建 08-12 后断层 21 天——**产品被弃用是常态**。"回顾"假设用户会回来续，但证据是不回来。
   - 30 秒 AI 回顾是**成本**（又一次全树 LLM 调用）。**建议降级为手动"回顾"按钮**（用户点了才生成），砍掉"距上次>X 天自动触发"（自动触发=用户一打开就等 30 秒）。
3. **P5 飞书推送——CONFIRM 砍 v1**（草案已延后）。密钥管理负担，确认 v1 不做。
4. **P1 moves 数量——建议 v1 收敛到 3 个**：草案 7 个 move（反驳/三视角/找盲点/复盘/风暴/收敛/重构框架）。**v1 先上最高频 3 个**（反驳我/找盲点/收敛），验证用户真用哪些，再扩。7 个一次上=数据驱动的好处（易扩）反而变成"一次做 7 个变体"的成本。

> 建议砍：P3 URL 素材导入（留 text 粘贴）、P4 自动回顾（留手动按钮）、P5 飞书 v1（已延后）；P1 moves v1 收敛到 3 个。理由统一：R20 实证零用/弃用常态 + 净新攻击面/成本，过度设计门禁适用。

---

## Q10 — 与既有机制的地雷清单

**裁决：2 处事实校正（route-convergence 已接线、share 复用 normalize）+ 3 处顺势接线机会 + 2 处破坏风险。**

### 事实校正
1. **route-convergence 已全链路接线（非"未接线"）**：契约 Q10 称"智能路由未接线"——**错**。实证：`parallel-ask.ts:30-38` 每次回答并行 `api.route(answerNodeId)`；`MainDoc.tsx:407 runRoutedAnswer` + `RoutePrompt`/`RouteErrorNotice`（MainDoc.tsx:36）+ `pendingRoute` state（:118）+ `setRouteState`（:462）+ store `routeByNodeId`（workbench-store.ts:280/318）。**它是对用户可见的活功能**（回答后弹"挂到主线/子文档/新分支"提示）。P0/P3 必须在"已有活路由"前提上设计，见 Q1（讨论条应走无路由路径）。
2. **share 复用 normalizeMarkdown + 只渲染 documentContentOf**：share-renderer.ts:5/165 复用 normalizeMarkdown（R17 F4 共享管线），:114/177/193 渲染 documentContentOf(node)。**新 discussion_messages 层默认分享不可见**（P0 scope-out 正确）；但 **P2 成文若存独立表，也分享不出去**（Q4）——要可分享须接 share-renderer。

### 顺势接线机会
3. **P4 决策日志 ↔ merges 表**：merges 已含 kind/direction（schema.sql:99-100，R18）。决策日志自动条目**直接读 merges**（correct 记录=决策），顺势接线，别新造。
4. **P2 脚注血缘 ↔ 现有血缘管道**：GET /api/trees/:id 已返回 annotations+merges（TASK.md 边界条，Hub 已实施）。脚注来源节点直接用这个，别新查。
5. **P0/P2/moves 流式 ↔ R25 心跳+watchdog**：answer.ts:57 heartbeat + client.ts watchdog（R25）。所有新的 LLM 流式路径**必须复用**，否则重演 R25 卡死。

### 破坏风险
6. **P0/P2 写 document_content ↔ R26 保存管线**（Q3 详述）：最大破坏面，强制复用 updateDocumentContent+baseRevision。
7. **成文/讨论总结进树 ↔ SessionMap**：若讨论总结放树内新节点（Q4 反对），SessionMap（会话地图，纯前端读 nodes store）会多出语义不同的节点，破坏地图视觉语义。放树外可避。

> 2 校正（route 已接线/share 复用 normalize）；3 顺势接线（决策日志读 merges、脚注读血缘管道、流式复用 R25）；2 破坏风险（document_content 保存管线 Q3、树内总结污染 SessionMap Q4）。

---

## 分 Phase 验收标准草案（终稿建议）

**修正后分期（采纳 Q8）**：

**Phase 1（对话可用且不瞎）= P0 + 跨分支 digest + CJK 等宽 + token 预算骨架**
- 验收：①讨论条流式对话（复用 R25 心跳，思考期有 ping）；②两/三沉淀动作写 document_content 走 updateDocumentContent+baseRevision，并发 409 正确重试，vault+快照同步（回归 R26：沉淀后 GET revision/doc_len 符合预期，vault 文件非空 hash 更新）；③digest 段注入对话上下文（浏览器实证讨论能引用他分支结论）；④CJK 代码块框图西文/中文等宽（CDP 实测列宽比≈2.0，仅代码块生效，行内 code/其他 --mono 不变，R8 几何不动）；⑤token 预算超配额逐源降级不炸。

**Phase 2（成文与脑暴）= P1 moves(v1 3个) + P2 成文 + P4 决策日志/开放问题**
- 验收：①moves 数据驱动配置加载，多步 move（若含）部分成功保留+每步 watchdog；②成文异步+SSE 进度，逐节点蒸馏防祖先回声，产物存树外独立产物（不进 SessionMap），脚注可跳转，接 share-renderer 可分享；③决策日志读 merges 自动生成；④开放问题抽取+resolved 状态，verdict 字段作否决一等公民。

**Phase 3（增强，可砍项）= P5 导出 + (P3 text 素材，URL 导入砍) + P4 手动回顾**
- 验收：①.md 下载+分享链接；②text 粘贴素材入上下文（无 URL 抓取=零 SSRF 面）；③手动"回顾"按钮（非自动）。

---

## 停止条件自检

- **不触发"方案与 owner 目标根本冲突"**：P0 讨论层是"和 AI 脑暴"的直接实现，减摩擦（独立表不膨胀树）。方向对。
- **不触发"必须先做 Phase B（四表示收敛）"**——**有条件**：Q3 已证 P0/P2 写 document_content **只要强制复用 updateDocumentContent+baseRevision+hydrate 守卫**，就不必先做四表示收敛。**但这是硬前提**：若 coder 实做发现沉淀需要 anchor 级插入而现管线只整体替换 document_content → 那时 blocker，可能要先收敛。**当前证据下不 blocker，但把这条写进 coder 契约的 stop condition。**
- 零数据风险（本轮零代码改动）；仓库状态与 TASK.md 一致（R25/R26/R27 已落盘 reports/coder-*.md 在场）。

---

## 给 Hub 的终稿建议（结论）

方案方向正确，切中 R20 痛点。给 owner 拍板前，建议纳入以下修正：

1. **[分期修正·Q8]** digest + CJK + token 预算骨架**提到 Phase 1**（质量地基与止血不排功能后）；素材 URL 导入后置/砍。
2. **[技术硬约束·Q3]** P0/P2 写 document_content **强制复用 updateDocumentContent+baseRevision+hydrate 守卫+vault 同步+快照**，禁第二条写路——**避免重演 R26 近失事故**。列为 coder 契约 stop condition。
3. **[事实校正·Q10]** route-convergence **已接线可见**（parallel-ask.ts:30/MainDoc.tsx:407）——讨论条设计要走**无路由轻量路径**；share 复用 normalize 且只渲 documentContentOf——成文产物要可分享须接 share-renderer。
4. **[语义补全]** 沉淀补第三动作"纠正"（复用 correct-service）；否决状态用显式 verdict 字段（Q5），别从 merges 反推。
5. **[砍/降级·Q9]** 砍 URL 素材导入（留 text 粘贴，零 SSRF 面）、P4 自动回顾降为手动按钮、moves v1 收敛 3 个、飞书 v1 确认砍。
6. **[成本·Q4/Q6]** 成文与多步 move 异步+SSE 心跳+并发上限+部分成功保留（复用 R25），否则重演卡死。

零生产代码改动（本报告）。停止条件当前均未触发（Q3 前提成立时）。

切换/回退触发器：若 Phase 1 中"P0 沉淀复用保存管线"被证实无法承载 anchor 级追加，回退 = P0 v1 只做"转子文档"沉淀（走既有 fork/createBlankNote 节点创建，不碰 document_content），"追加正文"延到四表示收敛后。此为 fallback，保 Phase 1 能上线。
