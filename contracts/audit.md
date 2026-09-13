# Audit 契约 — P1 空内容 bug 根因深查（只读）

## 1. Objective

一句话目标：**查清「AI 答完了但文档视图显示空态」这个 bug 的完整根因链，给出可执行的修复建议与影响面清单**。

背景：

owner 三周未用本产品，给出的弃用原因之一是「时不时有 bug」。coder 在 Round 20 顺手报了一条 caveat：新生成根笔记 `document_content` 最终为空串。**Hub 已用生产库确认这个 bug 真实存在，而且 owner 本人 9-02 就中招了**——那是他三周里唯一一次真实使用。

## 2. Scope

### 只读。零生产改动。

本轮**没有任何写权限**。你可以读代码、查数据库、起临时脚本探测、写报告，但：

- 禁止修改 `packages/**` 下任何源码
- 禁止写生产数据库 `vibe-local.db`（**只读查询**；如需实验请 `cp` 到 `/tmp` 操作副本）
- 唯一可写路径：`/Users/bytedance/.local/state/gsb-local/vibe-docing/reports/audit-p1-empty-content.md`

### Hub 已取得的证据（作为你的起点，但**必须独立复核**，不要直接采信）

**① 生产库实锤 —— 4 个节点 `document_content` 为空但 `ai_response` 有内容：**

```
wVjQWt-daJ9ec_r2VjgaF | 写一句：你好                    | dc=0 ar=263  | complete  | 2026-09-06T14:28
vaDHVSMBeKgC5mcL1xgih | 请输出一个完整的 TypeScript 防抖 | dc=0 ar=4367 | complete  | 2026-09-06T14:11
qgy8aTzaP6nWv-Ai40W5B | 请输出一个完整的 TypeScript 快排 | dc=0 ar=3680 | complete  | 2026-09-06T14:07
bf4TH6XG7A0bsSqRXfL5O | 下面的图画的没有对齐，重画一下    | dc=0 ar=60   | cancelled | 2026-09-02T13:13
```

后三条中 09-06 那三条是 coder 测试产生的（**可复现**）；`bf4TH6…` 是 **owner 2026-09-02 的真实使用**。

**② 全库字段状态分布：**

```
HAS  |HAS |complete  |34    ← 正常
NULL |NULL|complete  |5
EMPTY|NULL|complete  |4
EMPTY|HAS |complete  |3     ← bug 现场（内容被遮蔽）
EMPTY|HAS |cancelled |1     ← owner 9-02 那次
HAS  |NULL|complete  |1
```

**③ Hub 的初步假说（`shared/src/types.ts:146`）：**

```ts
export function documentContentOf(value) {
  return value.document_content ?? value.ai_response
}
```

`??` 只在 `null`/`undefined` 时 fallback，**空串 `''` 会原样返回**。所以一旦 `document_content` 被写成 `''`，`ai_response` 里的 4367 字就被完全遮蔽——视图显示空态，但数据其实还在。

**这只是假说。请独立验证，并特别注意它可能只是「显示层症状」，真正的问题是「谁把空串写进去的」。**

### 必答问题

1. **写入方是谁**：定位所有把 `document_content` 写成空串（而非 null）的代码路径。重点看 `node-repo.ts:93/101/147/190`、`routes/document-content.ts`、`service/answer-service.ts:110/155`、以及前端保存链（`editor/` 的 autosave / flush）。
2. **竞态是否成立**：coder 假说是「生成完成时空 flush 覆盖 updateGeneration 的写入」。**证实或证伪它**，给出时序证据（谁先谁后、哪个 revision 覆盖了哪个）。
3. **`??` vs `||` 的判断**：`documentContentOf` 改成 `||` 或显式空串判断是否安全？会不会有「用户就是想把文档清空」的合法场景被误 fallback 成旧的 `ai_response`？**这是设计问题，不要想当然。**
4. **影响面**：除了主文档视图，还有谁消费 `documentContentOf`？（Hub 已知 `vault-service.ts:122/123` 会据此写磁盘文件——**空串是否已经把 vault 里的 .md 文件写空了？这条务必查，涉及用户数据**）
5. **历史数据可否修复**：那 4 个节点的 `ai_response` 还在，能否安全回填？给出建议，但**不要执行**。
6. **是否还有同源 bug**：`EMPTY|NULL`（4 个）和 `NULL|NULL`（5 个）是什么情况？是正常空笔记还是另一种丢失？

### 复现要求

服务在跑（:4000 / :5173，provider 配置正常）。**请实际复现一次**：新建笔记 → 让 AI 生成 → 观察 `document_content` 的写入时序（可用 SQL 轮询或服务端日志）。复现步骤要写进报告，让 coder 能照着验证修复。

## 3. Validation

报告必须包含：

1. **根因链**：从用户操作到空串落库的完整调用路径，带 `file:line`。
2. **时序证据**：证实/证伪竞态假说，最好有时间戳或 revision 序列。
3. **每个必答问题的结论**，标注置信度（CONFIRMED / PLAUSIBLE / UNCERTAIN）。
4. **修复建议**：分「治标」（显示层 fallback）与「治本」（阻止空串写入），说明各自风险。给出你推荐的方案与理由。
5. **vault 磁盘文件是否受损**的明确结论。
6. **可复现步骤**。

不要提出修复代码的具体 diff——那是 coder 的事。你的产出是**诊断**。

## 4. Stop conditions

- 需要写任何生产文件 → 停，发 blocker。
- 需要修改生产数据库 → 停。用 `/tmp` 副本。
- 发现该 bug 会**持续损坏用户数据**（例如 vault 里的 .md 正在被写空）→ **立即发 blocker，不要等报告写完**，这是数据安全事项。
- 复现过程可能污染生产库 → 优先在临时树/临时笔记里做，并在报告中说明清理情况。

## 5. Reply route

- 进度/阻塞/结果：`node "/Users/bytedance/luobata/gsb-local/bin/relay.mjs" send hub <progress|blocker|result> '<json>'`
- 报告落盘：`/Users/bytedance/.local/state/gsb-local/vibe-docing/reports/audit-p1-empty-content.md`
- 发完消息唤醒 Hub：`bash "/Users/bytedance/luobata/gsb-local/bin/nudge" hub`

## 6. 方法论提醒

本项目 R11 立下的规矩：**UI/行为验证以真实回归为先，属性断言为辅**。R16 审计的元结论是「≥6 条同根：同一概念多份实现」——内容有四套表示（`ai_response` / `document_content` / vault 磁盘文件 / `node_versions`），这个 bug 很可能就是那个元问题的又一次发作。**查根因时请留意这条线索。**
