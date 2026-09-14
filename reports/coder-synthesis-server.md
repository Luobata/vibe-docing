# Round 28 Phase 2 · Contract A v2 · coder

日期：2026-09-14。状态：**服务端实现完成，交 Hub 验收**。基线 `019d2ea`，当前运行 **815/815 tests + typecheck 三包通过**。未 commit / push / deploy；未执行 :4000/:5173 restart 或 kill。

## 交付与影响路径

- `packages/server/src/service/synthesis-service.ts`、`routes/synthesis.ts`、`repo/synthesis-repo.ts`：整树 canonical Markdown 逐节点蒸馏，默认 3 路并发（`synthesis.concurrency` clamp 1–4），一次综合返回配置化六章，正文 `[^n]` 与脚注元数据保存树外。单节点失败保留原因并继续，全部节点失败或综合失败返回失败终态。
- `repo/open-questions-repo.ts` 与上述 service/routes：手动抽取开放问题、去重、编辑、resolve/reopen；已有 merges 与显式 verdict 构成决策日志；手动回顾按 input digest 缓存。
- `db/schema.sql`、`db/connection.ts`：新增 syntheses/open_questions/retrospectives；nodes.verdict 幂等 ALTER 在 migrateMerges 之后；启动时 queued/running 标 failed 并保留节点蒸馏。document_shares.synthesis_id 与两个独立部分唯一索引。merges schema / 事件语义未修改。
- `deps.ts`、`app.ts`：依赖和路由注册。`discussion-service.ts` 仅两处授权修改：digest verdict 叠加现有 merged 标记；导出 streamText 并参数化 timeout，默认 45,000ms 的行为/中文文案保持。
- `repo/share-repo.ts`、`service/share-service.ts`、`service/share-renderer.ts`、`routes/share.ts`：沿用原 token、管理接口模式和公开 HTML/MD/JSON 路由。成文分享只渲指定历史终稿，脚注定义转普通列表，normalizeMarkdown 与既有分享一致。节点分享和成文分享互不撤销。JSON 仍沿用 schemaVersion 1，成文表示为一个公开文档节点，不创建数据库节点。
- `packages/shared/src/line-diff.ts`、`index.ts`：旧 server 算法原文搬移，删除旧 server diff 与迁移其测试。versions.ts import 改 shared。CorrectiveMergeButton.tsx 只删除本地算法、改 import/类型。`types.ts` 仅可选 NodeRow.verdict 与 DocumentShareView.synthesisId。

## 前端契约 B 可接的 API

| 方法与路径 | 返回 / 行为 |
| --- | --- |
| POST `/api/trees/:id/synthesize` | SSE；重复 queued/running → HTTP 409 `{code:"SYNTHESIS_RUNNING", synthesisId, error}`；配置错误在 SSE 前返回 503 |
| GET `/api/trees/:id/syntheses` | `{syntheses}`，新到旧；每次重跑新 id |
| GET `/api/syntheses/:id` | `{synthesis}` |
| POST `/api/syntheses/:id/cancel` | `{synthesis}`；仅取消 queued/running，终态保持 |
| GET `/api/syntheses/:id/diff/:previousId` | `{lines}`，previous → current；同树校验；shared DiffLine |
| PATCH `/api/nodes/:id/verdict` | `{verdict: adopted|rejected|superseded|null}` → `{node}` |
| GET `/api/trees/:id/decisions` | `{merges,nodes}`；nodes 仅带非空 verdict 的 active 节点 |
| GET `/api/trees/:id/open-questions` | `{questions}` |
| POST `/api/trees/:id/open-questions/extract` | 一次模型抽取 → `{questions}`；trim/空白归一后同 tree+question 去重，已解决项不自动重开 |
| PATCH `/api/open-questions/:id` | `{status?:open|resolved,question?:string}` → `{question}`；编辑撞同题返回 409 |
| GET `/api/trees/:id/retrospective` | `{retrospective:null|row}`，最新 |
| POST `/api/trees/:id/retrospective` | `{retrospective,cached}`，同输入零模型调用 |
| GET/POST/DELETE `/api/syntheses/:synthesisId/share` | 复用 `{share}` / `{ok:true}`；只允许已完成成文；share 含可选 synthesisId |

SSE 帧均为 `data: <JSON>\n\n`：

- `started`：`{type,synthesis,total}`。
- `progress`：`{type,synthesisId,nodeId,status:done|failed,completed,total,failed,cached}`，每个节点完成/缓存命中一帧。
- `phase`：`{type,synthesisId,phase:"synthesis"}`，进入综合调用。
- `ping`：每 10 秒。
- 终态 `done` / `cancelled` / `error`：`{type,synthesis,failed,message?}`。

Synthesis 为 camelCase：id/treeId/status/contentMd/sections/footnotes/nodeResults/inputDigest/error/createdAt/updatedAt/finishedAt。sections 为 `{key,title,content}[]`；footnotes 为 `{number,nodeId,title,path:string[]}[]`，path 是树内标题路径；nodeResults 以 nodeId 为键，结果含 nodeId/cacheKey/status/content/error?/cached?。开放问题、回顾沿用数据库 snake_case 行形状。

## 状态、输入与取舍

1. 无常驻任务注册表。SSE 请求拥有本次 provider signals；cancel API 写 DB，当前请求每秒检查一次并 abort；断连立即 abort。心跳不喂模型 watchdog。启动恢复只在 openDb 进行，GET 不误杀在跑的任务。
2. snapshot 直接读 DB canonical 正文，不调用有落盘副作用的 hydrateNode。成文没有 document_content / vault / version 写入。外部 vault 修改须先由原有同步路径进入 canonical DB，才反映到本次输入。
3. 每节点输入只有自己的 Markdown 和最近 20 条讨论；复用预算，正文最多 8,000 字符、讨论最多 6,000 字符。父/祖先全文不进入该节点蒸馏。综合另读完整骨架（父子、兄弟、深度、verdict、脚注编号）、merges 与节点产物。
4. 节点缓存键包含存储 content_hash、canonical Markdown 实际哈希、最后消息 id、DISTILLATION_PROMPT_VERSION=1；实际正文哈希用于防止历史正文更新未刷新 content_hash。全树 digest 还含树标题、骨架/verdict、merges、六章配置。标题/verdict/结构变化只重做综合；正文/讨论变化重蒸馏对应节点。
5. 完全相同输入且上次所有节点成功时，新行复用全部节点及终稿，零 LLM。部分失败/取消/综合失败时复用成功节点，重试其余节点和综合，保留旧行供 diff。无自动重跑。
6. 90 秒是复用 streamText 的**文本空闲超时**，不是整个调用绝对时限；每次非空 chunk 重置。45 秒 Phase 1 语义未变。模型超时错误沿用 helper 的中文文案（成文调用显示“讨论生成超过 90 秒没有响应，请重试”）。
7. share 的 node_id 继续锚定树根以保留旧表约束和失效规则，实际内容按 synthesis_id 加载；删除树/根后分享失效。公开页脚注为静态普通列表，应用内可点击跳转由契约 B 负责。

## 当前运行验证

使用 Node `v22.21.1`（默认 Node25 与现有 better-sqlite3 ABI 不符），命令前缀：

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH
```

权威全量（项目根，2026-09-14 00:43 左右）：

```text
pnpm -r test
shared: Test Files 9 passed; Tests 45 passed
server: Test Files 60 passed; Tests 382 passed
web:    Test Files 50 passed; Tests 388 passed
EXIT_CODE 0

pnpm -r typecheck
shared Done; server Done; web Done; exit 0
```

合计 815=791+24。shared 原 43 加迁移测试 1、新边界测试 1；server 原 360 减迁移测试 1，加 synthesis service 14、routes 7、迁移 1、分享 1；web 388 不变。

新增服务 14/14：真实异步门控制可见最大并发 3；设置 0/9/invalid→1/4/3；节点输入隔离；综合父子/兄弟/merge/verdict；六章重排与脚注；节点 DB/版本零变化；相同输入零调用；正文/讨论/verdict 缓存失效；部分失败续跑；全节点/综合失败；90,000ms 边界与忽略 abort provider 的计时器清理；主动取消后复用完成节点；回顾缓存；三种 verdict 与已合并同时进入 discussion digest。

新增路由 7/7：started/分批 progress/phase/done；缓存重跑与历史/diff；10 秒 ping；重复请求 409；DB cancel ≤1 秒触发 signal；request/reply 双断连清理；verdict 校验和决策读取；问题抽取去重/resolve/reopen/edit；回顾缓存；不存在及配置错误。分享新增测试跨完整 repo→service→renderer→route 链路，验证双向互不撤销、多个成文独立、未完成拒绝、三种公开格式零原始正文泄漏、normalizeMarkdown、脚注普通列表。旧分享 12 项回归也通过。

曾在项目根直接执行 vitest 指定通用路径，误扫描 `.multi-agent/worktrees` 历史测试并因旧目录依赖缺失失败；改在 package cwd 聚焦执行后 19/19 + shared 2/2 通过。最终 pnpm -r test 只跑当前 packages，全绿。没有修改历史 worktree 源码。

lineDiff 当前运行等价性：用 TypeScript transpile 执行 HEAD 019d2ea 的旧 server 和旧 web 两函数，枚举空行/a/b/甲组成的 0–3 行输入，共 **7,225 对**，新 shared 输出分别与两旧函数 deepEqual。shared 文件与旧 server 原文件逐字节相同。web 文件经“仅移除旧函数并改 import/类型”的机械变换后，与当前文件逐字节相同。

## 数据迁移证据

通过 Python sqlite3 `file:...vibe-local.db?mode=ro` + backup 获取 WAL 一致快照，源连接只读。操作目标：

- `/tmp/vibe-synthesis-migration-4snqjwkh/copy.db`
- `/tmp/vibe-synthesis-migration-4snqjwkh/legacy-shape.db`

备份时源库已经包含 Phase2 新表与列，不能把该副本首次 open 声称为首次升级。coder 未执行显式源 DB 迁移或服务重启命令；现有 watcher/其他进程可能已加载编辑。此事实已通过 progress 告知 Hub。源库只读核对 merges=6。

copy.db 用当前 openDb 连续两次：merges **6→6→6** 完整行 deepEqual；canonical 节点正文/revision **59** 不变；share **2** 完整行不变；R18 kind/direction 和 landing_segment_id nullable 在场；两次 foreign_key_check=[]、integrity_check=ok。

为补首次升级，复制为 legacy-shape.db，先断言三张新表均空、verdict 全 null，再仅在此 /tmp 副本删除 Phase2 空新增结构/列/索引，保留原节点、merges、分享。随后当前 openDb 双跑：

```text
pass 1: merges 6, wholeNodesPreserved 59, sharesPreserved 2, foreignKeys ok, integrity ok
pass 2: merges 6, wholeNodesPreserved 59, sharesPreserved 2, foreignKeys ok, integrity ok
```

两次全节点/分享仅新增预期 null 字段，其余完整行 deepEqual。connection.test 另覆盖真实旧 merges 表形状的重建迁移（原既有用例继续通过）；新增用例覆盖 verdict/share 列缺失升级、孤儿 running→failed、缓存/问题/回顾保留、再次打开幂等。

## 范围与待 Hub 验收

启动时 261 个 package/src 文件 SHA256，与结束时 267 个文件比对：18 个原路径变化（含删除 2），新增 8；全部在 v2 白名单。唯一 web 路径为 CorrectiveMergeButton；discussion-service diff 限上述两处；没有 answer/merge/context-budget/其余 web/package/lock 改动。`git diff --check` exit 0。既有 plan 报告未改。报告与共享 reports 镜像逐字节一致。

尚不声明真实模型的六章内容质量、脚注语义准确性、20 节点 <5 分钟、回顾 <30 秒或前端体验通过；按契约由 Hub 做真实模型与浏览器验收。并发与超时用受控 provider 验证，不能替代真实耗时。综合和 P4 抽取只做一次调用，树级输入体量随节点数增长；未引入额外全树裁剪策略或模型调用门禁。成文输出要求六章 JSON，格式不符会保留节点缓存并返回可重试失败。


## 2026-09-14 · 契约 A 验收补丁：章节标题去重

按替换契约仅修改 synthesis-service.ts 的 sections map：保留原有章节存在/非空校验，在 trim 后识别首行 1–6 个 # 加空格/Tab 的 Markdown 标题，仅当标题文本 trim 后与当前 title 精确相等才移除该行并 trimStart。随后同一 sections 写入 sections_json 并组装 content_md；prompt、缓存键、六章配置、异常、并发、SSE 与取消均未改。分享层只消费 content_md，未发现第二处前置章节标题。新增测试先在原实现复现 2 失败/1 通过，修复后服务聚焦 17/17；新测试为 `strips a matching leading ## heading before saving sections and Markdown`、`strips a matching leading ### heading before saving sections and Markdown`、`preserves prose, different headings, non-headings and matching headings after the first line in both stored forms`，覆盖六章标题各恰一次、两种实际 DB 字段同步、CRLF/Tab/起始空白，以及正文/异名/7 个 #/无分隔空格/非首行同名标题不误删。当前 Node22 全量 `pnpm -r test` exit 0：shared 45（9 files）、server 385（60 files）、web 388（50 files），总计 **818/818=815+3**；`pnpm -r typecheck` 三包 Done，exit 0；`git diff --check` exit 0。267 个源码哈希相对本补丁起点仅 service 与其测试变化，无新增源码文件；报告只追加本段，遵守本补丁三路径白名单，未更新共享报告镜像。未操作真实 DB、未显式 restart/kill、未 commit/push。历史已保存终稿及其完整缓存保持原样，本补丁作用于新的综合结果；真实成文抽查交 Hub 复验。
