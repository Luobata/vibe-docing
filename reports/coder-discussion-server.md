# Round 28 Phase 1 · 服务端基础交付
日期：2026-09-13。状态：契约一实现及 Hub 附录要求的看门狗修正完成，当前运行验证通过，待 Hub 重跑 perspectives 活体验收。UI、回答路径、provider 和 vault-service 均未修改。

## 已实现的行为

1. discussion_messages 存储讨论，角色限 user/assistant，附沉淀目标与模式；schema.sql 和 connection.ts 按既有 CREATE IF NOT EXISTS 方式幂等升级。repo 提供 append、按节点时间序读取和 markPromoted；相同时间戳以 SQLite rowid 保持追加顺序，避免随机 id 打乱一问一答。
2. 对话走 provider.stream，不调用路由决策或带工具生成，不新增节点、不更新生成状态。用户消息在 provider 调用前落库；assistant 在本次输出完成后落库。未完成的输出在错误或取消时不落 assistant。
3. challenge、perspectives、converge 的指令集中在 DISCUSSION_MOVES 数据常量。三视角按架构师→保守派→用户代言人串行调用，已完成一步立即保存，下一步上下文带上前一步；后续失败返回 step/persona 和已经保存的 messages。
4. SSE 每个模型步骤有独立的 45 秒路由活性 watchdog。成功写出的 SSE 帧（含每 10 秒的 ping）刷新当前步骤的计时；模型没有正文输出不再导致超时。不可写或已销毁/结束的响应不刷新计时，请求/响应 close 仍立即向 provider 传递 abort。每步结束撤销活性订阅，路由结束清理监听器、心跳与超时；忽略 abort 的测试 provider 也不会卡住本次服务请求。
5. child 沉淀先蒸馏、后沿现有 nodes.create 的父节点/树/complete/title 创建约定创建节点，再走共用保存函数一次写入 Markdown、版本和 vault；selected messages 标记新子节点。没有创建多余空白版本。
6. section 沉淀将 AI prose 追加到现有正文，通过原内容保存管线处理 baseRevision、hydrate、锚点、版本、hash/vault；成功才标记已沉淀。Markdown 原有前缀字节保留，已有文本锚点位置不因文末追加而变化；旧表示转换时根据唯一引用文本定位，无法定位则沿既有 orphaned 表达处理。
7. correction 沉淀未新增服务端端点，留给下一份 UI 契约调用既有纠正接口。

## API 接入说明

以下路径均以 `/api/nodes/:id/discussion` 为前缀：

| 方法/后缀 | 请求 | 返回 |
| --- | --- | --- |
| GET | 无 | `{ messages }`，时间序全线程 |
| POST | `{ userInput }` | SSE chunk/ping/done/error |
| POST /moves | `{ move: 'challenge' \| 'perspectives' \| 'converge' }` | 同 SSE；move 的 chunk 带 1 起算 step 与 persona |
| POST /promote | `{ mode: 'child', messageIds: [...] }` | `{ node, content, messages }`，node 为新子文档 |
| POST /promote | `{ mode: 'section', messageIds: [...], baseRevision }` | `{ node, content, messages }`，content.revision 为新版本号；过期 409 |

SSE 使用 R25 相同的 `data: JSON\n\n` framing：
- chunk：`{ type: 'chunk', text, step?, persona? }`。
- ping：`{ type: 'ping' }`。
- done：`{ type: 'done', messages }`，**没有 answer 路由的 node 字段**。
- error：`{ type: 'error', message, messages, move?, step?, persona? }`。HTTP 流已开始后沿 R25 模式保持 200，以 error 帧表示失败；取消不额外写终态事件。
- message 行包含 id/node_id/role/content/created_at/promoted_node_id/promoted_mode。

空输入、未知 move、非法沉淀 body 为 400，缺失节点为 404，provider 配置错误在 SSE 开始前返回带 PROVIDER_CONFIG 的 503。section 的 409 包含 error、currentRevision、node；不调用模型的早期过期检查与模型运行期间发生编辑的最终检查均已覆盖。section 限 Markdown；Canvas/Base 可转子文档，不追加 prose 破坏原文件格式。

## 预算和跨分支记忆

入口在 `service/context-budget.ts`，独立于原回答 context-engine。v1 按字符配额近似上下文预算，不引入 tokenizer。

| 设置键（前缀 discussion.context.） | 默认 |
| --- | ---: |
| documentChars | 8000 |
| threadChars | 6000 |
| digestChars | 2000 |
| reservedOutputChars | 2000 |
| totalChars | 18000 |

通过既有 settings.get 留覆盖接口，无设置 UI。非法/负数配置回退到默认；有效值向下取整。有效预留输出最多等于总额度，避免配置超额时预算统计越界，该边界已补测。

- 对话只取本节点最近 20 条，再按配额裁剪。线程先丢最旧消息，单条超长时保留末尾并加“较早讨论已截断”标记。
- digest 收集当前节点的同层兄弟和沿祖先路径的兄弟分支，显示标题、正文首个非空行、已合并标记；标记来自既有 merges.listByTree 的 source_node_id。展示按更新时间近优先，超限时先舍弃距离远的分支，再舍弃同距离较旧分支。
- 正文走 documentContentOf → legacyDocumentToMarkdown，超限截中段，保留头尾并标记。
- 每源配额先独立收敛；若共享总额度仍不足，再按线程→digest→正文顺序降低。纯预算结果的 usedChars + reservedOutputChars 不超过总额。
- 沉淀按 messageIds 从本节点选取时间序片段，也经同一预算器；正文和分支摘要作为上下文，不扩大回答路径依赖。

## 保存路径的等价性与并发证据

`routes/document-content.ts:77` 导出 saveDocumentContent。原 PATCH handler 只改为传入 deps/nodeId/body、设置返回 statusCode/body；函数仍放在本次授权文件，未另建未经授权的写路径。

当前运行进行了三层验证：

1. **原测试字节不变**：document-content.test.ts SHA256 为
   `fbf902af589b7646d45018d5e5062772e73778a7c59123d15b87d9f4e6b57c86`，起点与终点一致。提取前 6/6、提取后 6/6、全量时同文件仍 6/6。
2. **机械对照**：将起点 handler 仅做 app.deps/request 字段参数化、缩进和 HTTP 返回包装转换后，得到的主体与最终保存函数逐字相同。校验条件、hydrate 时点、updateDocumentContent、事务、anchors、snapshotEditSession、vault.writeNode 和 409 payload 均无逻辑修改。
3. **新增运行锁**：section 追加保持原正文前缀/锚点，并创建版本、写 vault 和正确 SHA256；模型运行期间的原生编辑导致 409，保留新正文且不标沉淀；外部文件改动触发 hydrate 后的 409 也保留该同步状态。section 没有包裹额外外层事务，避免把原本在保存事务之前发生的 hydrate 回滚。child 创建才用外层事务保证失败时不遗留空节点。

讨论/沉淀读取正文和 digest 都复用 vault.hydrateNode；新增测试确认 R26 场景（DB 生成 PM JSON、vault 仍为旧的自有文件）在对话上下文中保留新正文且 revision 不变。

## 当前运行验证与范围

验证环境：Node 22.21.1，与当前 better-sqlite3 ABI 匹配。

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r build
git diff --check
```

- 本次修正后全量 **764/764**：shared **43**、server **357**、web **364**；契约起点 **731 → 764（+33）**。原 762 版本中把模型静默当作失败的用例按 Hub 新语义改为路由停止写入，扩展为两种故障；其余覆盖保留。
- 相比契约起点新增 33 项：迁移 1、repo 2、预算 4、discussion-service 9、discussion routes 17。
- 覆盖请求及响应断连、两类结束状态的心跳清理、持续 80 秒且有正文的流、第二视角静默 60 秒仍完成、路由停止写入后 45 秒取消且 provider 忽略 abort、三视角串行/第二步失败保留、纯文本无工具调用、用户先落库/完成后 assistant 落库、节点数量不增长、沉淀与并发。
- 最终版本聚焦 discussion routes/service **26/26**；全量测试 **764/764**，exit 0；typecheck 三包 exit 0；build exit 0，307 modules，5.32 秒。既有 React act 与 >500 kB chunk 提示保留。
- 契约起点/终点 packages 源码 SHA256 对比：仅 **15 个白名单源码/测试文件**变化，零删除；app.ts 恰好增加 import/register **2 行**。此次附录修正仅改 discussion-service.ts、routes/discussion.ts、routes/discussion.test.ts 三个源码文件及本报告。验证自动更新的 tsconfig.tsbuildinfo 为忽略的构建缓存。所有 web、provider、answer-service、correct-service、vault-service、原 context-engine 和 shared 源码字节未变。
- 变更路径：db/schema.sql、db/connection.ts 及其测试；新 repo/discussion-repo.ts、service/context-budget.ts、service/discussion-service.ts、routes/discussion.ts 及各自测试；app.ts、deps.ts、deps.test.ts；纯提取的 routes/document-content.ts；本报告及共享 reports 同文副本。

## Hub 活体验收后修正的回归证据

合同附录要求以 SSE 路由活性判断超时，未提高 45 秒阈值，也未改 provider 协议。路由将成功写入回调接给当前步骤，步骤 finally 撤销订阅；非空模型文本本身不再刷新 SSE 看门狗。

- fake provider 第二视角静默 **60 秒**，SSE 写出 **6 次 ping**，该步骤未 abort；释放模型等待后，三视角按序完成，done 含用户消息及三条 assistant，所有计时器清零。
- 故障用例先正常写出两次 ping，到第 20 秒停止写入；分别模拟 write 抛错、响应 destroyed 但未发 close。在最后成功写入后 **44,999 ms** 当前步仍存活，**45,000 ms** 取消。第一步已保存、第二步不落库、第三步不启动；错误保留 step=2/persona=保守派，close 监听器与计时器清零。
- 故障前 write 返回 false，验证 Node 已接受的缓冲写入仍计为活性，不把回压返回值误判成写失败。写入抛错由路由捕获，不造成心跳 interval 未处理异常。

## 取舍与剩余边界

- 当前运行使用 fake provider、内存 DB 和隔离临时 vault 验证。没有真实模型质量/MECE 完整性结论，没有调用真实树 API、改真实 DB 或重启服务；Hub 按合同活体验收，UI 留下一契约。
- 预算是字符近似。固定提示/来源标签在额度外，reservedOutputChars 是组装层预留，不改 provider 既有输出 token 上限。大量选中讨论同样会裁剪较旧内容；promoted 标记记录用户选择的来源集合，不保证模型逐句纳入全文。
- 当前步骤未完成的部分内容只在 SSE 上保留，不落 assistant；已经完整结束的前几步可在刷新后读回。忽略 abort 的 provider 会收到取消信号且请求可结束，但无法保证外部服务立刻停止计算。
- 按 Hub 附录裁决，持续成功写 ping 的 SSE 路由允许模型一直等待，不额外判断上游生成进度；本地 write 接受数据并不证明客户端已收到。路由完全不可写时，error 也无法送达客户端，但服务端仍取消当前步并保留已完成消息。非 SSE 的 promote 沿用原 45 秒正文空闲超时，此次只修讨论 SSE 的活性语义。
- section 正文保存成功后再更新沉淀标记；不新增跨文件系统/SQLite 的原子协议。沿用原保存管线既有的文件/DB 失败边界。child 成功时首个快照即沉淀正文。
- 不新增重复沉淀幂等门禁：重复 child 请求可能产生另一个子文档；section 要求最新 baseRevision。messages 的单个 promoted 目标字段记录最近一次沉淀，符合本轮给定表结构。
- R26 已知的元数据缺失时 ensureNodeFile 分支等 Phase B 问题没有扩修；本轮仅调用现有 hydrate，未绕开或改变其规则。
- 未提交、推送、部署，未修改 package.json/lock 或增加依赖。
