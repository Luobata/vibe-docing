# Contract: audit — Round 18 纠正性合并代码审查

Status: done (2026-08-31, reports/audit-round18.md — M1–M4 全部 PASS-with-notes，可以合入)
Issued: 2026-08-31 by Hub

## 1. Objective

审查 coder Round 18 交付（工作区未提交 diff，报告 reports/coder-round18.md，7 新文件 + 21 tracked 增量）。链路：`POST /api/nodes/:id/correct`（assembleForCorrection 组装 → provider → 结构化 patch/rewrite 草案，零落库）→ web CorrectiveMergeButton（方向必填/patch 默认/LineDiffView 复用/miss→纠正附注）→ `POST /api/nodes/:id/correct/commit`（前端提交最终全文 → 事务：before/after correction 快照 + document_content + kind='correction' merges 行）+ SessionMap 实线弧/tooltip + 分享回归。旧 merge/F1 保留。

审查焦点（你的 intent：过度改造/过于局限）：
1. **正确性**：commit 事务原子性与失败回滚；patch 前端顺序精确匹配的边界（同文多段、首尾空白、跨段落 quote）；schema2 升级路径（legacy ProseMirror before 快照存等价 Markdown + 采纳后升 schema2——回退到 before 会不会 schema 错配/内容损坏）；merges 表重建迁移的并发/半迁移状态安全；Vault 同步写（commit 写文件）与 DB 的一致性（一半成功怎么办）。
2. **过度改造**：28 路径里有无超出 M1-M4 必要的搭车（对照 contracts/coder.md Scope）；两次快照（before+after）是否合理取舍；12,000 字符上限实现是否最小。
3. **过于局限**：assembleForCorrection 是否真共享 resolve-segment 底座（还是又复制了一份解析）；LineDiffView 复用是否引入了 VersionPanel 不该承担的耦合；kind 字段是否只接了 SessionMap 一处（如 API 文档/其他消费方）。
4. **安全/健壮**：direction 长度上限（超长输入打 provider）；quote/replacement 超大 payload；commit 的 documentContent 校验（空/非法 JSON/schema 校验）。

## 2. Scope

- 读：仓库 + git diff。允许只读运行（vitest 单文件、node 脚本、sqlite mode=ro、curl GET 与**不会落库的** correct draft 探针）。禁止：commit/PUT/DELETE/correct/commit、git 写、重启服务、改文件。
- 写（仅两处）：`reports/audit-round18.md`；本契约 Status 行。

## 3. Validation

1. 逐焦点给 PASS / PASS-with-notes / FAIL + file:line。
2. 新缺陷按 P0/P1/P2（含触发场景）。
3. 结论一行：可否合入（用户未授权 commit，仅评估）。

## 4. Stop conditions

- 需 mutating 才能验证 → 标注 + 步骤。diff 与报告大面积不符 → blocker。

## 5. Reply route

- milestone：mailbox `progress`；卡点：`blocker`；完成：`result`（报告路径 + PASS/FAIL 计数 + 可否合入一行）→ hub。
