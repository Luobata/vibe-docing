# Round 24 · coder 交付报告：原生 Anthropic Provider

日期：2026-09-13。依据共享状态 contracts/coder.md 的 Round 24 契约；执行者 coder，最终裁决归 Hub。

契约实现与代码验证已完成，当前全量 **695/695（642 → 695，+53）** 通过。Hub 已将“切换时清空旧 provider 三字段”的裁决写入权威契约 §5，coder 核对后落实，原 blocker 已消除。真实端点生成验收由 Hub 进行，本报告不将 fixture 验证表述为真实服务成功。

## 改动范围

本轮开始对 packages 下 252 个源码/配置文件记录 SHA-256，结束比较：8 个既有文件变化、2 个新文件、0 删除；全部在白名单。没有修改依赖、真实 DB、服务进程、contracts 或 .gsb-local；没有 commit/push。

| 路径（相对仓库） | 本轮变化 |
| --- | --- |
| packages/server/src/provider/anthropic-provider.ts | 新增 180 行：消息/工具 schema 翻译、统一请求构造、按来源单认证头、SSE 解析，complete/stream/streamWithTools |
| packages/server/src/provider/anthropic-provider.test.ts | 新增 22 个测试，含八类 SSE fixture、出向翻译和截断/断连检测 |
| packages/server/src/provider/registry.ts、registry.test.ts | 新增 anthropic 分支；新增两协议实际请求路由测试，未知值仍 ProviderConfigError |
| packages/server/src/repo/settings-repo.ts、settings-repo.test.ts | provider-aware env 链与来源，Anthropic 专用 apiKeySource/maxTokens；新增 12 测试 |
| packages/server/src/routes/settings.ts、settings.test.ts | Anthropic 探针复用 buildAnthropicRequest；PUT 两值校验与切换清空三字段；新增 15 测试 |
| packages/web/src/components/SettingsPanel.tsx、SettingsPanel.test.tsx | 两服务商下拉、默认地址、来源刷新、OPUS 提示、切换清空警告；新增 2 测试 |

answer-service、assemble、codex-provider、provider/types、全部 shared、deps、api/client、Workbench.css 与本轮开始逐字节一致。上述文件中 R20–R23 的未提交修改保留；git 的累计 diff 不能全算本轮。本轮另写本报告及共享 reports 同名副本。

## 行为与取舍

- 所有 system（包含工具轮数上限时中途插入的 system）聚合到顶层；assistant 正文和 tool_calls 同时存在时保留两者；连续 tool 结果聚合为一条 user 的 tool_result 数组，原字符串保持。
- SSE 按 UTF-8 解码和事件边界解析，支持跨字节/CRLF，忽略 thinking/signature/ping。按 message_stop 终止并取消 reader；工具参数按 index 分别累积，结束后升序输出。abort 传给 fetch，且会终止剩余工具调用输出。
- complete 沿用 codex 的消费流并聚合文本实现。遇 HTTP/SSE error 抛脱敏错误；max_tokens 或未收到 message_stop 的断流明确失败，避免把不完整回答/工具参数当作完成。
- max_tokens 默认 32768；有效正整数 VIBE_LLM_MAX_TOKENS 可覆盖，无新 UI 设置。命中 token 上限时不会自动续写；提高值后重试仍取决于上游模型上限。
- 同一 provider 下 DB 非空字段优先保持 R23 语义。保存请求改变当前 codex/anthropic 服务商时，三连接字段置空，即使请求包含这些字段也不保留；旧值为不支持的遗留服务商时不触发清空。只有已保存 provider=anthropic 时读取 ANTHROPIC_*，VIBE_LLM_* 仍在 env 链中优先；codex 永不读取 ANTHROPIC_*。env 在 repo 构造时快照，切换 provider 后读取对应快照。
- AUTH_TOKEN 来源只用 Bearer；API_KEY / VIBE_LLM_API_KEY / DB / 未保存输入的 key 只用 x-api-key。probe 与真实请求共用 URL、headers 和请求体构造；probe max_tokens=1，错误分类沿用，不回传上游 body。
- 下拉切换未保存时隐藏旧来源徽标，显示「切换服务商会清空已保存的服务地址/模型/密钥，环境变量不受影响」，并提示先保存刷新再测试。保存没有编辑过的 model/baseUrl/key 时不会把旧 env/default 值固化到 DB；保存成功后回填新的有效配置与来源。
- 既有测试中“允许 custom provider”和“下拉仅 codex”两条断言，按本轮明确契约更新为两值校验/两选项，非放宽失败断言。

## 八组 fixture 与四个必做锁

fixture 位于 anthropic-provider.test.ts：

| 类别 | 用例名 |
| --- | --- |
| 纯文本 | streams plain text across byte boundaries and stops at message_stop without DONE |
| thinking | ignores thinking and signature deltas without including them in complete |
| 单 tool_use | accumulates one tool_use from partial_json fragments |
| 混合正文/工具 | emits text before the batched tool call in a mixed response；出向混合轮另有 #3 |
| 多 index 并行 | accumulates interleaved parallel tools separately and emits by ascending index |
| ping | ignores interleaved ping, comments and unknown events with CRLF frames |
| abort | forwards AbortSignal and rejects an aborted response read with AbortError（同时覆盖停止后续工具 emit） |
| error | throws for an error event without exposing upstream messages |

补充的切换锁：`clears saved connection fields on %s -> %s even with payload fields: %j`（双向 × 带/不带请求字段，4 例），并验证 env 来源恢复生效；另 2 例验证同 provider 保存/遗留非法值修复保留连接字段。UI 保存前显示警告、保存后消失由现有切换流程测试锁定。

四个锁的准确用例名：

1. #3 preserves assistant text plus tool_calls in a mixed round
2. #5 aggregates initial and mid-conversation system messages at the top level
3. #18 codex ignores all ANTHROPIC_* variables, including after switching back
4. #24 routes saved anthropic to Messages with one auth header: %s / draft %j / DB %j（六个来源/覆盖组合）

env 优先级对 baseUrl/model/key 分别枚举全部 4/4/8 存在组合，并在每个组合验证 DB 优先、空白 DB 回退和来源名。

## 当前运行证据

工具链：Node v22.21.1，PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH，pnpm 10.33。系统默认 Node 25 与项目已有 better-sqlite3 ABI 不匹配，因此使用项目已安装 Node 22。

最终全量 pnpm -r test（2026-09-13，exit 0）：

```text
packages/shared: 7 files, 34 passed
packages/server: 55 files, 307 passed
packages/web: 46 files, 354 passed
total: 695 passed (642 -> 695, +53)
```

- pnpm -r typecheck：shared/server/web 全部 Done，exit 0；最后源码修改后复跑通过。
- pnpm -r build：exit 0，web 307 modules、8.07s；唯一构建警告为已有 >500 kB chunk。
- 初次聚焦 provider/repo/registry/settings：87/87；补充切换规则后 settings routes 34/34、SettingsPanel 18/18，全部纳入最终全量 695。
- 全量测试仍有既有 MainDoc/TagChips 等 React act warning，不影响通过。
- 白名单路径 git diff --check：exit 0。仓库全局检查另报历史 contracts/coder.md EOF 空行，该文件非本轮写权，未改。

浏览器（当前运行 Chrome，独立临时 tab，未点击保存/测试连接）：

| viewport | 目视与 DOM |
| --- | --- |
| 1440×1000 | 两选项、选择 Anthropic、清空警告与保存后刷新提示、连接测试禁用；scrollWidth=1440，无横向溢出 |
| 1980×1000 | 清空警告及表单控件可见、排布正常；scrollWidth=1980，无横向溢出 |

已恢复默认 viewport 并关闭临时 tab。Anthropic 来源徽标/OPUS 提示与保存后测试完整流程由组件测试的模拟 API 验证；没有改真实 DB 来制造浏览器徽标证据。

## 交付 caveat

1. 按 Hub 契约 §5，切换会丢弃旧连接设置及同一次请求中输入的新连接值。需要手动配置新 provider 时先切换保存，再填写连接字段保存。界面显示清空警告；未增加额外确认弹窗。原 blocker 20260913073906506-coder-2cfe2cc1 已通过合同更新解决，通知消息 20260913075346877-hub-7da5b208 已核对并归档。
2. 未进行真实 Anthropic 端点生成/工具轮 E2E，也未重启服务。Hub 真实验收需确认服务启动进程继承 ANTHROPIC_*；修改 shell 后需由 Hub 安排服务重启。测试里的凭证全部 fixture，非真实密钥。
3. 默认模型保持原 alwaysday1_max；若没有 DB/env 模型，该名称是否受端点支持由上游决定，没有隐式猜测 Claude 型号。
