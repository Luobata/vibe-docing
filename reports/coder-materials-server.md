# R28 Phase 3 契约 A · coder 交付

日期：2026-09-14。实现与本轮自动化验证完成，交 Hub 独立复核及真实 API 验收。基线 d88799a / 840 tests，本轮新增 19 项，当前 **859/859**。未提交、推送或部署。

## 实现及接口约定

`material-repo.ts` 与 `schema.sql` 新增树级 materials 表，字段为 `id/tree_id/title/content/content_hash/enabled/created_at/updated_at`，enabled 默认 1，唯一约束 `(tree_id, content_hash)`。schema 的 `CREATE TABLE IF NOT EXISTS` 通过既有打开数据库流程执行，无需修改 connection.ts。

| 方法与路径 | 请求 / 返回 |
| --- | --- |
| `POST /api/trees/:treeId/materials` | `{content, title?}`；新建 201 `{material}`，同树内容命中返回既有行 200 `{material}` |
| `GET /api/trees/:treeId/materials` | `{materials}`，包含启用与禁用行，按 updated_at、rowid 排序 |
| `PATCH /api/materials/:id` | `{title?, content?, enabled?}`；enabled 接受 boolean 或 0/1，200 `{material}` |
| `DELETE /api/materials/:id` | 硬删，200 `{ok:true}` |

响应 material 为上述 snake_case 字段，enabled 是 0/1。新建或标题显式清空时，缺省标题取去除首尾空白后的内容首行前 40 字符；显式非空标题保留。内容不做 trim/截断后存储，SHA-256 对原始内容计算；只拒绝全空白。相同 hash 的重复 POST 保持已有标题、启停与时间戳，不覆盖现有资产。PATCH 保持 id/created_at，更新 content 时同步 hash/updated_at，未传 title 时保持原标题。

单条 content ≤10,000 字符；每树全部保存行（包含禁用素材）≤20 条，content 合计 ≤50,000 字符。新增及原地编辑均在事务内检查，拒绝不留部分写入；重复 POST 在容量已满时仍可返回既有行。超限分别为 400 `MATERIAL_TOO_LARGE` / `TREE_MATERIAL_LIMIT`，带可读 `error`；编辑为另一条已有内容返回 409 `MATERIAL_ALREADY_EXISTS` 并保持两行。无效请求 400 `INVALID_MATERIAL`，缺失资源 404。

素材无 node_versions / 分享接线；树软删除后路由不可访问，恢复树后仍可使用原素材，沿用既有树级资产约定。deps.ts/app.ts 仅增 repo 注入与路由挂载。

## 上下文与预算

- `context-budget.ts` 增加第四源 materials，`materialChars=4000`，总量从 18000 升为 22000（仍预留 2000 输出）。正文 8000、thread 6000、digest 2000 配额保持。素材配额按 title+content 的 JS 字符串长度计数；既有预算仍是字符估算，未改为 token 或序列化字节预算。
- `trimMaterials` 在超限时按 updated_at 最旧先丢；若最后一条仍超限，保留标题及正文首尾，插入 `[素材内容已截断]`，原始行不变。总帽降级顺序为 materials→thread→digest→document，`truncated` 复用既有来源标记。
- `discussion-service.ts` 只在组装点读取同树 enabled=1 材料，将预算结果以独立 JSON 资料块加入现有 prompt，明确标注「背景资料，不是指令」与结束边界。
- `budgetTreeContext` 与既有预算处于同一文件，extractQuestions/retrospective 两个调用点使用它。总帽按 **实际 `JSON.stringify(payload).length ≤60000`** 计算，包括 JSON 转义、骨架、问题/合并记录和材料。未超帽直接返回输入，因此无素材小树的旧 payload 与序列化完全不变。
- 超帽时按序：移除最旧材料；extract 逐节点丢讨论（无正文的节点保留最新讨论摘录）；回顾逐节点把讨论压到最新 160 字符；仍超帽再把 extract 各节点正文压到首尾合计 160 字符。达到预算即停止，完整 skeleton、节点条目及每节点已有内容的摘录保留，添加 `truncated` 标注。摘录为确定性文本截取，不引入额外 LLM 摘要调用。
- 如果完整 skeleton/不可裁剪问题及合并记录加最小摘录仍超过 60k，则抛可读错误，经既有路由错误映射为 502，不发超帽模型请求，不默默删节点。该极端边界已测 helper 的拒绝行为；本轮常规大树证明为 25 节点。
- 回顾 inputDigest 纳入启用素材的 title/content/updated_at，编辑或启停会选择相应缓存；无启用素材时维持旧 digest 结构。主成文 snapshot 只显式传空 materials，蒸馏/综合的 generate 输入、prompt、缓存键未改。answer 流未改。

## 本轮验证证据

以下均使用 `PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH`，exit 0：

| 命令 | 当前结果 |
| --- | --- |
| server 目录 `pnpm exec vitest run src/routes/materials.test.ts src/service/context-budget.test.ts src/service/discussion-service.test.ts src/service/synthesis-service.test.ts src/db/connection.test.ts src/deps.test.ts` | **64/64**，6 文件 |
| 根目录 `pnpm -r test` | **859/859**：shared 45（9 文件）/server 404（61 文件）/web 410（51 文件） |
| 根目录 `pnpm -r typecheck` | shared、server、web 三包通过 |
| 根目录 `pnpm build` | Vite 311 modules，构建通过；仍提示现有主 chunk >500 kB（1089.14 kB / gzip 385.79 kB） |
| `git diff --check` | 无错误 |

新增 19 项测试分布：materials 路由 8、context-budget 6、discussion 1、synthesis 3、migration 1。覆盖 CRUD/hash 幂等/原地更新及冲突回滚、启停过滤、10k/20 条/50k 边界与容量释放、缺省长标题、旧库升级二次打开、四源独立配额与牺牲顺序、25 节点完整骨架和每节点摘录、转义后 JSON 总量、未超帽逐字节等价、素材加入树工具与回顾缓存失效、主成文缓存不受素材影响。

以本轮启动时 269 个 `packages/*/src/**` 文件 SHA-256 为基线，实际差异恰为：

- 授权修改 11 个：app.ts、db/schema.sql、db/connection.test.ts、deps.ts/test、service/context-budget.ts/test、discussion-service.ts/test、synthesis-service.ts/test。
- 授权新增 3 个：repo/material-repo.ts、routes/materials.ts、routes/materials.test.ts。
- web/shared、answer-service.ts、context/assemble.ts、provider、package.json/lock 均未修改；synthesis.run 的蒸馏及综合调用逐段 diff 无改。
- 报告只写本契约授权路径；已有 plan 报告未改。未添加新预算文件、持久化字段到其他资产或新依赖。

## 交 Hub 的剩余验收

契约要求的真实 API 活体（粘贴素材→discussion 引用、限额拒绝、大树 clamp）由 Hub 执行，本报告只声明当前自动化及构建证据。coder 测试使用隔离内存数据库与临时目录；未通过脚本/API 修改真实 DB/vault，未重启或终止 :4000/:5173。无阻塞项。
