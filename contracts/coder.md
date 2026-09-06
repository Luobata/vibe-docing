# Contract: coder — Round 17 第一批修复（P0×3 + 规整器共享最小版）

Status: done（2026-08-31：M1–M4 + F5 全部交付；Hub 独立复验 542/542+typecheck+build ✓、audit 全 PASS、运行时/浏览器/真实 LLM 草案三级验证 ✓；报告 reports/coder-round18.md）
Issued: 2026-08-31 by Hub
依据：reports/review-2026-08-31.md（终稿，已三方对齐：Hub 取证 + plan 反证 + audit 深查）

## 1. Objective

落地 4 项已裁决修复，全部针对 Round 16 确认的缺陷：

1. **F1 重复合并幂等（P0，A1+A7）**：同一 (source,target) 重复合并被拒绝。
2. **F2 分享正文 safeLine 污染（P0，B4）**：按字段分流转义，正文 markdown 源不再被全局改写。
3. **F3 分享派生子节点双重渲染（P0，B2）**：annotation 块不再内联子节点完整正文。
4. **F4 规整器共享最小版（P1，BS2/㉓）**：`normalizeTables` 提升到 `@vibe/shared`，与 `normalizeFencedCodeBlocks` 合成单一 `normalizeMarkdown()`，web 与 share-renderer 共用，分享链路立即继承围栏/表格修复。

## 2. Scope

**写白名单（唯一 writer：coder，仅以下文件）：**

- `packages/server/src/service/merge-service.ts`（F1 幂等）
- `packages/server/src/repo/merge-repo.ts`（F1 增按 source+target 查询）
- `packages/server/src/routes/merge.ts`（F1 已合并→409 结构化错误码）
- `packages/web/src/components/MergeButton.tsx`（F1 前端消费服务端 merges 数据）
- `packages/server/src/service/share-renderer.ts`（F2+F3+F4 接线）
- `packages/shared/src/`（F4：normalizeTables 迁入 + normalizeMarkdown 导出；可改 code-fence.ts 或新增 markdown-normalize.ts，同步 index.ts 导出）
- `packages/web/src/doc/markdown.ts`（F4：改 import，删除本地 normalizeTables 实现）
- `packages/server/src/routes/share.test.ts`（**扩权 2026-08-31**：仅限第 40 行单 H1 断言按 F2 裁决更新为期望 2 + 紧邻正文保真断言；不得改动该文件其他逻辑）
- 上述文件对应的 `*.test.ts` / `*.test.tsx`

**禁改**：packages/web/src/components/ 其余组件、schema.sql / 任何迁移（F1 明确不做 UNIQUE 索引——见 §4）、其他 services、CSS、git 写操作。工作区大量未提交用户改动，改前先读目标文件当前内容，只做增量修改。

## 3. Validation（done-when）

1. `pnpm test` 全绿（基线 463：shared 29 / server 172+ / web 262+，允许因新增用例增长）。`pnpm typecheck`×3、`pnpm build` 通过。
2. 新增测试至少覆盖：
   - **F1**：同 (source,target) 二次 merge → 抛领域错误、HTTP 409、无新增 segment/merge 行；provider.complete 在幂等命中时**不被调用**（预检）；并发语义由"事务内权威检查"测试背书（mock provider 异步、两次并发 merge 仅一条落库）。前端：store 的 treeMerges 含该 source 时按钮呈"已合并"态（不依赖内存 mergeState）。
   - **F2**：构造含 ```代码块（内含 `\d+`、`C:\path`、行首 `#` 注释）、LaTeX `\alpha`、多级标题的文档 → 分享 markdown/HTML 中代码逐字保真（无 `\\` 翻倍、无 `\#`）；正文标题照常渲染为标题。与 web `renderMarkdown` 对同一 fixture 的关键输出做一致性断言（标题层级、代码内容逐字）。
   - **F3**：带派生子节点的分享文档，子节点正文在输出中**恰好出现一次**（其自身分支节）；annotation 块保留"派生子节点：label"引用行。
   - **F4**：share-renderer 渲染含病态围栏空行与松散 GH 表格的文档时输出与 web 一致（表格成型、围栏空行剥离）；web 既有 markdown 测试不回归。
3. 报告实际改动 diff 摘要与测试计数。**改动范围门禁**：若发现需要动白名单之外任何文件才能完成，停下发 blocker，不得自行扩权。

## 4. Stop conditions

- **历史重复数据不动**：vibe-local.db 里已有的 3 条重复 merge 与堆积 segment 是用户数据，禁止任何清理/迁移脚本。F1 用服务层幂等（better-sqlite3 事务同步单连接，事务内查重无竞态；provider.complete 前可先做廉价预检省 LLM 调用，事务内做权威检查）。
- **F2 前置求证**：动手前先用测试钉住现状——若现有 share 测试证明"正文标题被转义不渲染"是被断言锁定的**有意行为**（与本契约假设冲突），发 blocker 附证据，等 Hub 裁决，不要猜。
- **产品语义门禁**：已合并后**不提供**"重新合并/regenerate"（P2 另议）；不删源分支、不加自动收口；不做 UNIQUE 索引。
- 若某修复与工作区未提交改动冲突（同文件同区域），发 blocker 说明冲突点。

## 5. Reply route

- 里程碑：每完成一项 F* 发 mailbox `progress`（附关键测试名）。
- 卡点：mailbox `blocker`（question/missing/safe_fallback）。
- 完成：mailbox `result`（附：四项各自状态、diff 统计、测试计数、自验命令输出摘要）。Hub 将独立复跑测试与抽查 diff，复杂渲染改动会转 audit 审查。
