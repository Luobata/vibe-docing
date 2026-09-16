# Round 28 · Phase 4 反证审计：表达带走（一键下载 .md + 分享链接）

- 日期：2026-09-14
- 角色：plan（实现设计反证，只读，唯一可写本报告）
- 审计对象：Hub Phase 4 设计（docs/brainstorm-workbench-2026-09-13.md §Phase 4 + 契约 Q1-Q7）
- 基线 b385033（877 tests）。验收锚：下载的 .md 在 Typora/飞书粘贴均正常。
- 方法：全部裁决基于当前仓库源码取证（file:line）。

## 摘要（TL;DR）

**Phase 4 比方案设想小得多——大部分"表达带走"已经存在，真正缺的只有"真下载"这一个动作。**

关键取证：
1. **分享链接全都在了**：主文档 SharePanel（Workbench.tsx:403）+ 成文 SynthesisPanel 分享（SynthesisPanel.tsx:233-236，Phase 2 落地）。两者都已暴露 `/share/:token.md`（share.ts:79-85，`text/markdown`）。
2. **但 .md 是 `Content-Disposition: inline`（share.ts:79）——浏览器里打开显示，不是下载文件**。且入口埋在"给 AI 或其他工具读取（高级）"折叠区（SharePanel.tsx:113）。
3. **前端已持有原始 markdown**：MarkdownEditor.tsx:61 用 `legacyDocumentToMarkdown(documentContentOf(node), schema)`——与服务端**同一个 shared 转换器**。所以**单节点下载可纯前端 Blob，零服务端改动**。

**核心裁决**：
- **Q1/Q6**：v1 = 单节点文档下载 + 成文下载**两个入口**（都已有分享面板可挂），不做整树拼接（无单一 .md 语义，成文 synthesis 就是树级带走路径）。
- **Q2/Q7**：**纯前端 Blob 对单节点可行且最小**（前端有原始 md + shared normalize）；但**成文/带子文档血缘的完整文档，前端拿不到 share-renderer 的组装产物**，那部分要么复用现有 `/share/:token.md`（已存在）、要么服务端加 `attachment` 下载端点。**证伪"纯前端 Blob 覆盖全部"**——成文和多节点组装是服务端产物。
- **Q3 红线**：下载**不需要也绝不能写 document_content**（只读 documentContentOf → 转 md → Blob/serve），stop condition 不触发。

逐条如下。

---

## Q1 — 下载对象与入口

**裁决：CHALLENGE 草案的模糊（"下载什么"未定）；裁决 v1 = 单节点主文档 + 成文两入口，都挂现有分享面板旁。**

- **现有分享 UI 入口取证**：
  - 主文档：`SharePanel`（SharePanel.tsx:10）挂在 **Workbench.tsx:403**（`nodeId={mainNodeId}`），主工具栏"分享"按钮。**主文档视图有分享入口**。
  - 成文：`SynthesisPanel`（SynthesisPanel.tsx:233-236）有独立的创建/打开/复制/撤销分享（Phase 2 落地）。**成文有分享入口**。
  - **主文档视图无任何"下载"按钮**（grep 全 web 无 download/导出/Blob 下载，只有 CanvasEditor 的无关默认文件名 CanvasEditor.tsx:238）。
- **"表达带走"对 owner 的最小闭环**：owner 目标是"生成更好的文档带走"（docs 目标）。带走 = 拿到一个 **.md 文件**能贴进 Typora/飞书。当前只能：打开分享面板→展开"高级"折叠→点 Markdown 链接→浏览器显示 md 文本（inline）→手动全选复制/另存。**这不是"一键带走"**。
- **v1 下载对象裁决**：
  - **主文档节点（document_content）**：最直接的"带走这篇"。前端已有原始 md（Q2），一键 Blob 下载。
  - **成文（synthesis content_md）**：树级带走路径（"整个脑暴的成果文档"）。content_md 已是完整 markdown（synthesis-service.ts:152-153）。
  - **两者都做**——它们是两种"带走"语义（这一篇 vs 整树成果），都已有分享面板可就近挂"下载"。
- **反对只做一个**：只做主文档=树级成果带不走；只做成文=没成文时（没跑 synthesize）带不走当前文档。owner 常态是看着一篇文档想带走它，成文是可选高级动作。**两入口覆盖两场景**。

> CHALLENGE 草案未定对象；裁决 v1 双入口——主文档节点下载（挂 SharePanel 旁/主工具栏）+ 成文下载（挂 SynthesisPanel 旁）。整树拼接不做（Q6）。

---

## Q2 — 下载机制：前端 Blob vs 服务端端点

**裁决：CHALLENGE"前端 Blob 最小"的普适性——单节点前端 Blob 可行且最小，但成文/组装文档必须走服务端；建议混合。**

- **前端 Blob 对单节点可行（证据）**：
  - 前端已持有原始 md：MarkdownEditor.tsx:61 `legacyDocumentToMarkdown(documentContentOf(node), node.content_schema_version ?? 0)`——**与服务端 vault-service.ts:122、share-renderer 同一个 shared 转换器**（legacyDocumentToMarkdown 在 packages/shared/src/markdown.ts:77）。
  - normalize 一致性有保证：web renderMarkdown 用 `normalizeMarkdown`（markdown.ts:101），share 也用（share-renderer.ts:5），都是 shared 的 normalizeMarkdown（markdown-normalize.ts:55 = normalizeFencedCodeBlocks + normalizeTables 复合）。**前端下载前跑一遍 normalizeMarkdown，产出与 share .md 单节点部分逐字节一致**。
  - 机制：`new Blob([md], {type:'text/markdown'})` + `URL.createObjectURL` + `<a download>`。**零服务端改动**。
- **但前端 Blob 拿不到组装产物（证伪"纯前端最小覆盖全部"）**：
  - share-renderer 的 renderShareMarkdown（share-renderer.ts:122）组装的是**整个 ShareDocument**——主节点 + 子文档树 + 视觉引用 + 注释（share-renderer.ts:36-39 ShareNode tree）。**前端单节点 md 不含子文档/血缘**。
  - **成文 content_md** 在服务端（syntheses 表），前端 SynthesisPanel 拿到的是渲染用数据——要下载完整成文，最干净是复用已存在的 `/syntheses/:id/share` → `.md`（Phase 2 已建）。
- **文件名清洗**：需要 sanitize（防路径/非法字符）。有先例：sanitizeTreeFolder/sanitizeDirectory（trees.ts / vault-service.ts:150，Round 22-23 收敛过）。前端 Blob 也要清洗文件名（用节点标题/树标题，去非法字符）。
- **裁决：混合**：
  - **单节点主文档 → 前端 Blob**（最小，零后端，前端已有 md + normalize）。
  - **成文 + 需组装血缘的完整文档 → 复用现有 `/share/:token.md`**（已存在），但改进为可下载（见下）。
- **inline vs attachment（关键改进点）**：现有 `/share/:token.md` 是 `Content-Disposition: inline`（share.ts:79）——**在浏览器打开而非下载**。若要"点击即下载文件"，要么：①前端对该 URL 用 fetch→Blob→download（前端全权，零后端）；②服务端加 `?download=1` 走 `attachment`。**推荐①**（前端把 inline URL 变成下载，零后端改动）。

> CHALLENGE 纯前端普适；裁决混合：单节点前端 Blob（零后端，shared 转换器保证 normalize 一致），成文/组装文档复用现有 share .md + 前端 fetch→Blob 转下载（把 inline 变 attachment，仍零后端）。文件名走 sanitize 先例。

---

## Q3 — vault"已有基础"的真实含义

**裁决：CHALLENGE"下载复用 vault 文件"——vault .md 只是节点自身 body、受 hydrate 守卫、非组装产物；下载应从 DB documentContentOf 取，不碰 vault。红线：下载零写 document_content（stop condition 不触发）。**

- **vault 写盘链取证**：
  - `writeNode`（vault-service.ts:147）在每次 schema-2 内容保存时被调（document-content.ts:128），写 `legacyDocumentToMarkdown(documentContentOf(node))`（vault-service.ts:122）。
  - `hydrateNode`（vault-service.ts:130）读盘回灌 DB，但有 R26 的 **hash+mtime 双守卫**（vault-service.ts:137 `contentHash === node.content_hash` 才跳过）。
- **vault .md 与 document_content 是否逐字节一致**：
  - **对已保存的 markdown 节点**：writeNode 写的就是 legacyDocumentToMarkdown(document_content)，所以 vault .md ≈ document_content 的 markdown 化。**但不是"逐字节等于 document_content"**——document_content 是 schema-1 PM JSON 或 schema-2 md source；vault .md 永远是 markdown。对 schema-2 节点两者接近，对 schema-1（PM JSON）节点，vault .md 是转换产物。
  - **一致性风险**：R26 事故正是 vault 文件与 DB 不同步（0 字节文件回灌清空 DB）。hydrate 守卫是**防回灌覆盖**，不是保证 vault 永远最新。**未编辑过的新生成节点可能无 vault 文件**（writeNode 只在 PATCH /content 保存时调，answer-service 生成走 updateGeneration 不写 vault）。
- **下载该从哪取**：
  - **从 DB `documentContentOf(node)` → legacyDocumentToMarkdown → normalize**（与 share/web 同链），**不复用 vault 文件**。理由：①vault 文件可能缺失（未编辑的生成节点）；②vault 是 markdown 转换产物，DB 是权威源；③绕开 hydrate 守卫的复杂交互。
  - DB 取值是**只读** documentContentOf——**绝不写 document_content**。
- **stop condition 红线自检**：下载路径 = 读 documentContentOf → 转 md → Blob/serve。**零 document_content 写入**。契约红线（"下载必须写 document_content 才能实现 → blocker"）**不触发**——下载天然只读，无需写任何东西。

> CHALLENGE 复用 vault 文件（可能缺失/是转换产物/hydrate 交互）；裁决从 DB documentContentOf 取（权威源，与 share 同链），只读零写。stop condition 不触发（下载纯读）。

---

## Q4 — 分享链接的增量

**裁决：CONFIRM 分享已基本齐备；Phase 4 对"分享"的增量≈零，真正增量是"下载"+ 入口显性化。**

- **分享覆盖面取证**：
  - 主文档：SharePanel @ Workbench.tsx:403（主工具栏，mainNodeId）。✓
  - 成文：SynthesisPanel 分享 @ SynthesisPanel.tsx:233-236。✓
  - 格式：html（`/share/:token`）+ markdown（`/share/:token.md`）+ json（`/share/:token.json`），share.ts:85-90。✓
  - 类型：DocumentShareView 含 `url/markdownUrl/jsonUrl`（types.ts:228-234）。✓
- **哪些视图没有分享**：子文档（SubdocTabs）、单个非主节点——但**主文档分享已含子文档树**（share-renderer 组装整树 share-renderer.ts:36-39），所以子文档通过主文档分享已覆盖内容。
- **Phase 4 对分享的真实增量**：
  - **功能上≈零**（分享全在）。
  - **入口显性化**：markdown 链接埋在"给 AI 或其他工具读取（高级）"折叠（SharePanel.tsx:113）——owner 想"带走"找不到。Phase 4 可把"下载 .md"提为**显性一级动作**（不藏折叠）。
- **结论**：**Phase 4 ≈ 纯下载功能 + 入口显性化**，分享本身不需要新建。这印证摘要——Phase 4 比设想小。

> CONFIRM 分享齐备（主文档+成文+三格式，types.ts:228/share.ts:85）；Phase 4 增量≈下载动作 + 把 md 从"高级折叠"提为显性带走入口。分享无需新建。

---

## Q5 — Typora/飞书正常的技术含义

**裁决：CONFIRM 可拆为断言清单；用真实树下载后 grep 断言验证。**

验收锚"Typora/飞书粘贴正常"拆为 md 内容属性清单：

| 属性 | 断言 | 现状证据 |
|---|---|---|
| 围栏代码块（ASCII 图）保留 | ` ```...``` ` 三反引号围栏完整，内部空行不被 normalize 破坏 | normalizeFencedCodeBlocks（code-fence.ts:35）R9 修过病态空行；围栏字符保留 |
| 表格管道语法 | `| a | b |` + 分隔行 `|---|` 完整 | normalizeTables（markdown-normalize.ts:20）R9 修过 |
| 脚注 `[^n]` | 成文脚注 `[^n]` + 定义 `[^n]: ...` 成对（仅成文有） | synthesis contentMd（synthesis-service.ts:152-153）脚注定义在文末 |
| 标题层级 | `#`/`##` 正确，无跳级注入 | 成文 `# title` + `## section`（synthesis-service.ts:152） |
| 无裸 JSON | 无 `{"type":"doc"...}` 字面 | R26 A2 已修（doc 形状容忍+转换失败空串）；legacyDocumentToMarkdown 转 md 非 JSON |
| 无 safeLine 污染 | 正文标题不被 `\#` 转义（share 正文已 parity，R17 F2） | share-renderer proseMirrorMarkdown 走正常渲染（share-renderer.ts:116），safeLine 仅元数据 |

- **自动化验证（不需真实 LLM，成本零）**：对真实库某树，下载/取其 md，grep 断言：①` ```` `围栏成对且内无连续空行病态；②`|---` 表格分隔存在；③无 `{"type":"doc"` 子串；④成文 md `[^` 脚注引用有对应 `[^n]:` 定义；⑤`^#{1,6} ` 标题层级连续。
- **Typora 特性**：Typora 对标准 CommonMark + GFM（表格/围栏/脚注）支持好；normalizeMarkdown 产出是标准 md，**风险低**。飞书粘贴：飞书 md 粘贴支持标题/表格/代码块，脚注可能降级为普通文本（飞书脚注支持弱）——**但这是飞书限制非 md 缺陷**，验收标准应聚焦"内容不丢、结构正确"，脚注在飞书降级为文本可接受。

> CONFIRM 可测断言清单（围栏/表格/脚注/标题/无裸JSON/无safeLine）；用真实树下载后 grep 自动验证（零 LLM 成本）。飞书脚注弱支持是平台限制，验收聚焦内容完整+结构正确。

---

## Q6 — 整树导出边界

**裁决：CONFIRM 单节点+成文两入口足够；整树拼接一份 .md 不做 v1（无单一语义，成文即树级路径）。**

- **方案文档只写"一键下载 .md"单数**（docs §Phase 4）——**单数是有意的**。
- **整树拼一份 .md 的问题**：
  - 树是**分支探索结构**（多个平行/冲突分支），线性拼成一份 md **语义不明**（按什么顺序？冲突分支怎么并列？）——这正是 P2 成文（synthesize）要解决的"把树蒸馏成结构化文档"。**裸拼 = 劣质成文**。
  - 主文档分享已含子文档树（share-renderer 组装 share-renderer.ts:36-39）——若要"主文档+其子文档"的组合 md，**现有 `/share/:token.md` 已提供**（renderShareMarkdown 组装整个 ShareDocument）。
- **树级带走的正解 = 成文（synthesis）下载**：synthesize 就是"把整树变成一份好文档"（六章节+血缘）。**成文 content_md 下载 = 树级带走**，且是**结构化的**而非裸拼。
- **裁决**：
  - 单节点下载（这一篇）+ 成文下载（整树成果）**两入口覆盖**。
  - "主文档+子文档组合"已由现有 share .md 覆盖（若需要，前端把该 URL 转下载）。
  - **裸树拼接不做**——它劣于成文，且无清晰语义。

> CONFIRM 两入口（单节点+成文）；整树裸拼不做 v1（语义不明且劣于 synthesize；树级带走=成文下载，组合 md 已由现有 share .md 覆盖）。

---

## Q7 — 最小改动清单证伪

**裁决：单节点下载可纯前端零后端；成文下载复用 Phase 2 已有 share；总体 Phase 4 是小前端轮 + 可选后端 attachment 改进。**

估计实现清单，逐条证伪：

| 项 | 是否需要 | 更小路径 |
|---|---|---|
| **单节点主文档下载** | **纯前端**：MainDoc/Workbench 加"下载"按钮 → 前端已有 legacyDocumentToMarkdown+normalizeMarkdown（MarkdownEditor.tsx:61 先例，shared 转换器）→ Blob + `<a download>` | **零后端**。前端已持原始 md，无需任何 API |
| **成文下载** | 复用 Phase 2 `/syntheses/:id/share` → `.md`（已存在）→ 前端 fetch→Blob→download | **零后端新增**（share 端点已在，只需前端把 inline URL 转下载） |
| 文件名清洗 | 前端一个 sanitize 函数（去非法字符，用标题） | 复用 shared sanitize 思路（trees.ts/vault-service.ts:150 先例），或前端简单正则 |
| inline→下载 | 前端 fetch(shareMdUrl)→blob→createObjectURL→a.download | **零后端**（不改 Content-Disposition） |
| server attachment 端点 | **可选、不必需** | 若坚持"点链接即下载"体验，加 `?download=1` 走 attachment（share.ts:79 附近，一处）——但前端 fetch→blob 已达同效，**建议不加** |
| client.ts API | 单节点下载**不需要**（前端有 md）；成文下载复用已有 getSynthesisShare | 最小 |
| 分享入口新建 | **不需要**（Q4，全在） | — |

- **证伪"是否需要 server 改动"**：**单节点下载完全不需要 server 改动**（前端有 md + shared 转换器）。成文下载**也不需要 server 新增**（share 端点已在，前端 fetch→blob 把 inline 变下载）。**Phase 4 可做到零后端改动**。
- **唯一后端可选项**：`?download=1` attachment（体验糖），但前端 fetch→blob 已覆盖，**建议 v1 不加**（保持零后端）。

> 证伪成立：Phase 4 **可零后端改动**。单节点=纯前端 Blob（shared 转换器保证与 share 一致），成文=复用 Phase 2 share + 前端转下载。最小路径 = 一个前端下载工具 + 两处按钮 + 文件名清洗。

---

## 风险清单

| 级别 | 风险 | 证据 | 处置 |
|---|---|---|---|
| 低 | 单节点前端 md 与 share 组装 md 不同（不含子文档/血缘） | share-renderer 组装整树 :36-39，前端只有单节点 | 明确"下载这一篇"=单节点语义；要整树用成文下载 |
| 低 | 未编辑生成节点无 vault 文件 / vault≠DB | writeNode 只在 PATCH /content 调（document-content.ts:128），生成走 updateGeneration | 从 DB documentContentOf 取，不碰 vault（Q3） |
| 低 | 文件名非法字符/路径注入 | 用户标题作文件名 | sanitize（trees.ts/vault-service.ts:150 先例） |
| 低 | 飞书脚注弱支持 | 平台限制 | 验收聚焦内容完整，脚注降级文本可接受（Q5） |
| 极低 | normalize 不一致 | 前端与 share 都用 shared normalizeMarkdown | 已一致（同一函数 markdown-normalize.ts:55），下载前跑一遍 |
| — | **红线：写 document_content** | 下载纯读 documentContentOf | **不触发**（Q3），无 blocker |

---

## 契约拆分建议

**单契约（web-only）即可**——Phase 4 零后端改动（Q7）：

**契约 · web（下载 + 入口显性化）**
- 写权白名单：新增前端下载工具（`packages/web/src/flow/download-markdown.ts` 或类似：legacyDocumentToMarkdown+normalizeMarkdown+文件名 sanitize+Blob+a.download）+ 测试；改 MainDoc.tsx/Workbench.tsx 加"下载"按钮（挂 SharePanel 旁，≤数行）；改 SynthesisPanel.tsx 加成文下载按钮；Workbench.css 前缀追加。
- 复用强制：md 转换复用 shared legacyDocumentToMarkdown（markdown.ts:77）+ normalizeMarkdown（markdown-normalize.ts:55）——**禁自写第二个 md 转换/normalize**（R16 重复实现教训）；成文下载复用 getSynthesisShare 的 markdownUrl。
- 停止条件：①若发现下载必须写 document_content → blocker（Q3 红线，但已证不会）；②若单节点前端 md 与需求不符需组装 → 用现有 share .md（不新建组装逻辑）。
- 回归锁：877 tests 不破；零后端改动（不碰 server/DB）；MainDoc/Workbench 挂载点 ≤±数行（Phase 1/2 先例）；CSS 前缀追加不动保护区。

**可选后端小改（不建议 v1）**：`?download=1` attachment（share.ts:79）——前端 fetch→blob 已覆盖，v1 跳过。

---

## 给 Hub 的结论

**Phase 4 是全案最小的一轮——大部分已存在，真正缺"真下载"这一个动作，且可零后端。**

1. **[Q1/Q6] v1 双入口**：单节点主文档下载 + 成文下载。整树裸拼不做（劣于成文；组合 md 已由现有 share .md 覆盖）。
2. **[Q2/Q7] 零后端可达**：单节点纯前端 Blob（前端已有 md via MarkdownEditor.tsx:61 的 shared 转换器）；成文复用 Phase 2 `/syntheses/:id/share` + 前端 fetch→blob 把 inline 转下载。
3. **[Q3 红线] 下载从 DB documentContentOf 只读取值**，不碰 vault、绝不写 document_content——stop condition 不触发。
4. **[Q4] 分享已齐备**（主文档 Workbench.tsx:403 + 成文 SynthesisPanel + 三格式）；Phase 4 增量≈下载 + 把 md 从"高级折叠"（SharePanel.tsx:113）提为显性带走入口。
5. **[Q5] 验收断言清单**（围栏/表格/脚注/标题/无裸JSON/无safeLine）+ 真实树下载后 grep 自动验证（零 LLM 成本）；飞书脚注弱支持是平台限制。
6. **契约**：单 web 契约即可（零后端），复用 shared 转换器禁自写第二份。

零生产代码改动（本报告）。stop condition 不触发（下载纯读）。**这是六件套的收尾轮，风险最低。**
