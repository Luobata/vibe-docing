# Contract: plan-backup — Round 19 聚焦反证：合并说明泛化（merge instruction）

Status: done
Issued: 2026-08-31 by Hub
Completed: 2026-08-31 by plan → reports/plan-merge-instruction-2026-08-31.md（总判：泛化对、后端近零改；1 前提校正：33 是测试数非"零回声补丁数"）
背景：owner 2026-08-31 定向「设计上不一定是纠正生成，可以在合并的时候增加**合并说明**，用来引导合并」→ 纠正只是说明的一种特例，合并由用户说明引导。

## 1. Objective

对 Hub 的**泛化设计**做聚焦反证（短平快，只攻下列裁决点，不做全库重审）：

**Hub 设计**：
1. 输入泛化：correct 端点 `direction` → 语义升级为 `instruction`（合并说明）。API 字段名：**保留 `direction` 不改名**（避免 client/测试无谓 churn），仅语义与文案泛化？还是趁机改名？Hub 倾向保留字段名。
2. 输出三态：patch（改原文）/ **append（新增节，不动原文，新增模式）** / rewrite（整篇重写）。三者统一落 document_content + correction 版本快照（append 也是版本变更：可回退/分享可见/不回 segment 老路）。
3. append 落点：新节固定追加文末（标题模板如 `## 合并说明 · <分支首行>`），还是用户可在弹窗选插入位置（某标题下）？Hub 倾向 v1 文末固定，位置交给用户采纳后手动挪（diff 可见）。
4. prompt 泛化：assembleForCorrection 的"纠正方向置顶 + 靶子段"结构改为"合并说明置顶 + 父文档参考段 + 证据段"——**攻这点：泛化后会不会稀释 R18 真实验证的 33-patch 零回声质量？**（靶子段标注"勿照抄"对 append 模式是否仍必要/是否会误导模型不敢引用父内容？append 场景恰恰需要参考父内容。）
5. UI 文案：按钮「按方向纠正父文档」→「按说明合并到父文档」；字段「纠正方向」→「合并说明」（placeholder 示例含纠正/提炼/整理三类）；版本标签「纠正合并」→「引导合并」；SessionMap tooltip 同步。**内部枚举/changeKind/merges.kind 不动**（零迁移）。

**必须回答**：
- Q1 append 模式与旧 merged-conclusion 语义的边界：append 落 document_content 而非 segment，确认分享/撤销/搜索链路无坑。
- Q2 prompt 泛化的措辞方案：如何写"说明置顶"使纠正类说明仍保持零回声、非纠正类说明（提炼/整理）允许合理参考父文？给建议措辞。
- Q3 三态 UI：mode 单选三选一是否比"纠正/非纠正"两分更乱？有无更简形态（如 append 与 patch 由模型按说明自选+用户可切换）？Hub 倾向显式三选一（可预期性优先）。
- Q4 R18 刚上线的按钮/弹窗文案改动是否伤 e2e/测试锚点（grep 测试中的文案断言）。

## 2. Scope

- 读：仓库（重点 CorrectiveMergeButton/correct 路由/assemble-correction/相关测试文案锚点）。允许 sqlite ro。
- 写（仅两处）：`reports/plan-merge-instruction-2026-08-31.md`；本契约 Status 行。
- 禁改：packages/**、git 写、mutating API。零生产代码改动。

## 3. Validation

- Q1–Q4 逐一裁决 + file:line 证据；给实施改动面清单（供 coder 直接派发）；指出最大风险一行。
- 快：本契约是聚焦反证，预期报告 ≤1.5 屏。

## 4. Stop conditions

- 发现泛化与 R18 结构冲突需重设计 → blocker。

## 5. Reply route

- 完成：mailbox `result`（报告路径 + Q1–Q4 一行裁决 + 改动面一行）→ hub；卡点 blocker。
