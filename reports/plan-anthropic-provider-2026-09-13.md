# Round 24 · plan 反证审计：原生 Anthropic 协议 Provider（follow alias）

- 日期：2026-09-13
- 角色：plan（聚焦反证，只读，零生产代码改动）
- 审计对象：Hub 设计草案（contracts/plan.md §「Hub 设计草案」）
- 方法：全部裁决基于当前仓库源码取证（file:line）。**重要前提：R22/R23 均已落盘**（git status 见 folders.ts / folder-path.ts / settings-repo env 链 / settings.ts test 端点 / getProviderSources 全在场），本轮审计针对 **R23 已交付后的当前代码**，非旧版。

## 摘要（TL;DR）

方向可做，适配器模式是正确的架构选择，answer-service 的消息形状**可以在 provider 层完整翻译**（Q1 逐形状核对通过，含混合 assistant text+tool_calls）。但发现 **1 个架构友点 + 3 个必须收口的裁决**：

1. **[架构友点·必须解决]** R23 的 env 解析是**provider 无关**的：`providerEnv` 在 repo 构造时快照（settings-repo.ts:25-29），`resolveField` 不看 provider（settings-repo.ts:44-49）。草案 §3 要求 ANTHROPIC_* **「只在 anthropic provider 下」**读——这与 R23 的干净结构冲突。`resolveField` 必须变成 provider-aware，或 env 变量集按 `provider.name` 切换。这是本轮最大的落地改造点，Q3 详述。
2. **[CHALLENGE·Q4]** 双认证头（x-api-key + Bearer 同值）对 bigmodel 已实测双通，但对**官方 Anthropic 端点**：官方用 `x-api-key`，`ANTHROPIC_AUTH_TOKEN` 语义是 OAuth Bearer——两者可能是**不同凭证类型**，同值双发在官方端点上有风险。建议按来源分头。
3. **[CHALLENGE·Q2]** max_tokens 常量 16384 对长答案有截断风险，且 codex 路径完全不发 max_tokens——两 provider 行为差异要显式。建议留 `VIBE_LLM_MAX_TOKENS` 覆盖 + 取较大默认（如 32768）。
4. **[CONFIRM·Q3 但附警告]** ANTHROPIC_* 相干集合论证成立（key 与 baseUrl 天然配对，规避 R23 误捡关切），但 `ANTHROPIC_DEFAULT_OPUS_MODEL` 语义是"claude CLI 的 opus 档位映射"，别人配 opus-4.x 时会拿到意外模型名——徽标回显是必要但**不充分**的兜底。

逐条裁决如下。

---

## Q1 — 适配器模式 + answer-service 全部消息形状枚举

**裁决：CONFIRM 适配器模式正确；消息形状已逐一枚举并确认可翻译，含草案担心的"混合 assistant 文本+tool_calls"轮。不触发 stop condition。**

### 全部消息形状（代码实证枚举）

Provider 接口有三个方法（types.ts:16-27）：`complete` / `stream` / `streamWithTools`。翻译器必须覆盖所有向它们传入的 `ChatMessage`（assemble.ts:15-20：`{content:string, role, tool_calls?, tool_call_id?}`）。

**A. `stream(messages)` 与 `complete(messages)` 路径的消息形状**（非工具）：
- assembleContext 产出（assemble.ts:40-71）：
  - `{role:'user', content}`（含前缀 `[祖先摘要]`/`[聚焦]`/`[已并入结论]`，assemble.ts:34-38/67）
  - `{role:'assistant', content}`（祖先答案，assemble.ts:61）
  - 末尾 `{role:'user', content: currentUserInput}`（assemble.ts:70）
- autoTagNode（answer-service.ts:65-68）：`{role:'system'}` + `{role:'user'}`
- merge-service（merge-service.ts:36-42）：`assemble()` + `{role:'assistant'}` + `{role:'user'}`
- correct-service（correct-service.ts:104-111）：`assembleForCorrection()` 产出（context-engine，同 ChatMessage 类型）+ complete
- route-decision（route-decision-service.ts:165-176）：`{role:'system'}` + `...contextMessages` + `{role:'user'}`

→ 全是 `system/user/assistant` 纯文本形状。翻译规则：`system` → 顶层 `system` 参数（**多条 system 要聚合**，见下警告）；`user`/`assistant` → content 文本块。**覆盖 ✓**。

**B. `streamWithTools(messages, tools)` 路径**（answer-service.ts runToolLoop）额外形状：
- **混合轮 `{role:'assistant', content: roundText, tool_calls:[...]}`**（answer-service.ts:233-241）——**这正是草案 Q1 担心的"assistant 文本+tool_calls 混合轮"**。实证：`content: roundText`，而 `roundText` 累积了本轮所有 text 事件（answer-service.ts:209 `roundText += event.text`），**可以非空**（模型先说话再调工具）。翻译规则：anthropic content 数组 = `[{type:'text', text:roundText}（若非空）, {type:'tool_use', id, name, input}...]`。**必须处理 roundText 非空**：漏掉会丢失模型的思考前言（虽然 answer-service 中间轮文本不写正文，但它是**对话历史的一部分**，下一轮模型要看到自己上轮说了什么）。**覆盖 ✓，但翻译器必须显式支持 text+tool_use 混合 content 块，不能假设 assistant 轮要么纯文本要么纯 tool_calls。**
- `{role:'tool', content, tool_call_id}`（answer-service.ts:261/265/269-273）——翻译规则：user 侧 `{type:'tool_result', tool_use_id: tool_call_id, content}`。**连续 tool 消息聚合到一个 user 轮**（草案已提，anthropic 要求 tool_result 在 user 消息里；多个工具结果应在同一 user content 数组）。**覆盖 ✓**。
- 中途 `{role:'system', content:'工具调用轮数已达上限...'}`（answer-service.ts:278-281）——**这是"对话中途出现的 system 消息"**，不是开头。anthropic 只有**顶层单个 system 参数**，中途 system 无处安放。翻译规则：中途 system 要么合并进顶层 system，要么降级为 user 消息。**这是一个隐蔽形状，草案未点名**——翻译器必须处理"非首条 system"，否则这条兜底提示丢失（虽非致命，但会让轮数上限兜底失效）。

### 警告：多条 system 消息的聚合
- anthropic 顶层 `system` 是单个字符串/块。但消息流里 system 可能出现多次：autoTagNode 开头 system、runToolLoop 开头 push 的 system（answer-service.ts:178-185）、route-decision 开头 system、以及中途兜底 system（answer-service.ts:278）。翻译器必须**收集所有 system 消息聚合成一个顶层 system**（保持顺序拼接），不能只取第一条。**这是 Q1 覆盖性的关键细节，coder 契约必须写明。**

### 结论
- 适配器模式（answer-service 零改动）**成立**：所有形状都能在 provider 层双向翻译，**无需改 service**。不触发"必须改 service"的 stop condition。
- **但翻译器复杂度被草案低估**：至少 3 个非平凡点——(1) assistant text+tool_calls 混合 content、(2) 连续 tool_result 聚合到 user、(3) 多条/中途 system 聚合到顶层。这三点必须进 coder 契约的显式验收清单，否则"零改动 service"会以"翻译器漏形状"的形式反噬。

> CONFIRM 适配器模式 + 消息形状全覆盖（含混合轮）；CHALLENGE 草案对翻译器复杂度的低估——3 个非平凡翻译点必须显式列入契约。

---

## Q2 — max_tokens 取值裁决

**裁决：CHALLENGE 常量方案；建议 `VIBE_LLM_MAX_TOKENS` env 覆盖 + 较大默认（32768），并显式文档化两 provider 差异。**

- 实证：codex-provider **完全不发 max_tokens**（codex-provider.ts:64-73 body 只有 messages/model/stream；grep 确认无 max_tokens）。anthropic **必填**（Hub 探针实测钉死）。这是两 provider 的**真实行为差异**。
- 常量 16384 风险：本应用是**长文档生成器**（answer-service 生成整篇笔记，merge 生成结论，correct 生成纠正全文）。16384 tokens ≈ 1.2 万汉字，长答案/长纠正**会被截断**，且截断是静默的（anthropic 到 max_tokens 就 `stop_reason:'max_tokens'`，SSE 正常结束，用户看到的是**被截断的答案**，无报错）。这比 codex 无上限的现状是**回归**。
- 建议：
  - 默认取**较大值 32768**（甚至 65536，取决于 glm-5.3 上限；bigmodel glm 系列通常支持较大 max_tokens）。
  - **留 `VIBE_LLM_MAX_TOKENS` env 覆盖**——与 R23 的 VIBE_LLM_* 命名空间一致，owner 可调。这也顺带给 codex 一个未来的可选上限位（本轮不必给 codex 加）。
  - **不从 answer-service 的 options 透传**（那要改 ProviderStreamOptions 接口 + 所有调用点，超范围且违反"零 service 改动"）。取值应在 **provider 内部**从 config 读（config 里带 maxTokens，来自 settings-repo 的 env 链）。
- 显式差异文档：provider 层注释说明"anthropic 必发 max_tokens（截断风险），codex 不发"，避免未来困惑。

> CHALLENGE 常量；裁决：provider 内部从 config 读 maxTokens，默认 32768，`VIBE_LLM_MAX_TOKENS` 可覆盖。截断风险是 vs codex 的真实回归，必须给足默认。

---

## Q3 — env 链扩展对 R23 裁决的推翻是否成立

**裁决：CONFIRM 相干集合论证成立（有条件）；但发现【架构友点】——R23 的 env 解析是 provider 无关的，"只在 anthropic 下读 ANTHROPIC_*"需要结构改造，不是加几行兜底。**

### 相干集合论证成立
- R23 裁决"只认 VIBE_LLM_*"的核心关切是**误捡无关 key**（本机 7 个 *_API_KEY，plan-provider-simplify-2026-09-13.md Q1）。
- 草案 §3 的反驳成立：`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_BASE_URL`/`ANTHROPIC_DEFAULT_OPUS_MODEL` 是**同一 alias 配置的相干三元组**——key 与 baseUrl **天然配对**（都指向同一个 anthropic 兼容端点），不存在"key 指向 A 端点、baseUrl 指向 B 端点"的误配。这与孤立的 `GLM_API_KEY`（无配套 baseUrl）本质不同。
- **前提条件**：这个论证**只在"用户显式选了 anthropic provider"时成立**。如果 codex provider 也读 ANTHROPIC_*，就退回 R23 的误捡问题（用户为 claude CLI 配的 ANTHROPIC_* 被 codex 路径捡走）。所以**"只在 anthropic 下读"是这个裁决成立的必要条件**，不是可选优化。

### 架构友点（本轮最大落地风险）
- **R23 的 env 解析是 provider 无关的**：
  - `providerEnv` 在 `createSettingsRepo` 构造时快照（settings-repo.ts:25-29），只快照 VIBE_LLM_*。
  - `resolveField(field, fallback)`（settings-repo.ts:44-49）**不接收 provider 参数**，直接查 `providerEnv[field]`。
  - `getProviderConfig`（settings-repo.ts:51-58）在 line 56 才解析 `provider: get('provider.name')`——**provider 名与 env 解析在同一函数，但 resolveField 先跑、provider 后取**。
- 草案 §3"只在 anthropic provider 下读 ANTHROPIC_*"要求 **resolveField 必须知道当前 provider**。这需要：
  1. `resolveField` 增加 provider 入参，或
  2. `getProviderConfig` 先解析 provider.name，再按 provider 选择 env 变量集（codex→仅 VIBE_LLM_*；anthropic→VIBE_LLM_* > ANTHROPIC_*），把变量集传给 resolveField。
- 同时 `getProviderSources`（settings-repo.ts:60-71）的 `sourceVars` 常量（settings-repo.ts:23）也是 provider 无关的硬编码 VIBE_LLM_*——**必须同步 provider-aware**，否则 anthropic 下徽标会显示错误的变量名（显示 VIBE_LLM_BASE_URL 而实际用的是 ANTHROPIC_BASE_URL）。
- **这不是"env 链扩展几行"，是 R23 结构的一次 provider-aware 重构**。coder 契约必须写明改造 resolveField/getProviderSources 两处的签名，并**回归 R23 的 codex env 测试**（settings-repo.test.ts 的 VIBE_LLM_* 用例必须仍绿，且新增"codex 下不读 ANTHROPIC_*"断言防误捡回归）。

### ANTHROPIC_DEFAULT_OPUS_MODEL 语义警告
- 该变量语义是"claude CLI 把 opus 档位映射到哪个模型"。owner 的值恰是 glm-5.3（可用），但**别人**的 `ANTHROPIC_DEFAULT_OPUS_MODEL` 可能是 `claude-opus-4-x` 或其它——直接当默认模型用，会让别人的应用**默默用了 opus 档位的模型**（可能贵、可能不是他想要的）。
- 徽标回显（"来自 ANTHROPIC_DEFAULT_OPUS_MODEL"）是**必要但不充分**：它让来源可见，但用户未必理解"opus 档位"的含义。**建议**：徽标文案对该变量特别标注（如"来自 ANTHROPIC_DEFAULT_OPUS_MODEL（claude 别名的默认模型）"），或在 provider 选择 anthropic 时给一行说明。这是可见性的加强，非阻塞。

> CONFIRM 相干集合论证（前提：只在 anthropic 下读）；CHALLENGE 草案把它当"env 链扩展几行"——实为 resolveField/getProviderSources 的 provider-aware 重构，必须回归 R23 codex 路径 + 新增"codex 不读 ANTHROPIC_*"防误捡断言。OPUS_MODEL 语义徽标需加强。

---

## Q4 — 双认证头兼容性

**裁决：CHALLENGE 无条件双头；建议按来源分头（AUTH_TOKEN→Bearer，API_KEY→x-api-key），复杂度值得。**

- 实证：bigmodel `POST /api/anthropic/v1/messages` 对 `x-api-key` 与 `Bearer` **均 200**（Hub 探针）。所以对 owner 的 bigmodel 端点，双头**当前可用**。
- 但对**官方 Anthropic 端点**（api.anthropic.com）与常见网关有风险：
  - 官方 Anthropic 规范：认证用 **`x-api-key: <key>`**（key 形如 `sk-ant-...`）。
  - `ANTHROPIC_AUTH_TOKEN` 语义：claude CLI 用它装 **OAuth Bearer token**（订阅登录场景），与 `ANTHROPIC_API_KEY`（直接 API key）**是不同凭证类型**。
  - 风险：如果同一个值同时塞进 `x-api-key` 和 `authorization: Bearer`，在严格校验的端点上，**一个头对、一个头错**可能导致 400/401（有些网关校验所有出现的认证头）。双头"都发同值"是"赌两个头至少一个被接受且另一个被忽略"——bigmodel 宽松所以过，官方/严格网关不保证。
- **建议按来源分头**（草案 Q4 的后者）：
  - `VIBE_LLM_API_KEY` / `ANTHROPIC_API_KEY` → `x-api-key`（官方语义）。
  - `ANTHROPIC_AUTH_TOKEN` → `authorization: Bearer`（OAuth 语义）。
  - 这要求 env 链**记住 key 的来源**（哪个变量命中）。复杂度：resolveField 本来就要返回 source（settings-repo.ts:44 已返回 `{value, source}`），只需**再返回命中的变量名**（getProviderSources 已经在算 sourceVars，settings-repo.ts:66-69）——**信息已经在算了，接出来用即可，增量复杂度小**。
  - 值不值：**值**。分头是"按凭证语义正确发送"，双头是"赌端点宽松"。owner 现在用 bigmodel 双头能过，但本轮是要交付"原生 Anthropic 协议 provider"，应对官方端点也正确。分头的增量成本（传递来源变量名）很小，因为 sourceVars 机制已存在。
- **兜底**：若坚持简单，**默认单头 `x-api-key`**（官方标准）比双头更安全——bigmodel 也接受 x-api-key（探针实测 x-api-key 200）。双头是最不必要的选择（多发一个可能冲突的头）。**最小安全解 = 单 x-api-key；语义正确解 = 按来源分头。双头不推荐。**

> CHALLENGE 双头；裁决优先级：按来源分头（sourceVar 信息已存在，增量小）> 单 x-api-key（官方标准，bigmodel 也过）> 双头（最不推荐，赌端点宽松）。

---

## Q5 — SSE 解析器测试策略

**裁决：CONFIRM 需要 fixture 事件流；给出最小充分集，标注 bigmodel 实测与官方规范差异点。**

- anthropic SSE 与 codex 的**结构差异**（决定测试重点）：
  - codex：`data: {json}` 行，`data: [DONE]` 哨兵（codex-provider.ts:89）。
  - anthropic：`event: <type>` + `data: {json}` 成对，**无 [DONE]**，以 `message_stop` 事件终止（Hub 探针钉死）。delta 在 `content_block_delta` 的 `delta.type`（thinking_delta/text_delta/input_json_delta）。
- **最小充分 fixture 集**：
  1. **纯文本流**：message_start → content_block_start(text) → 多个 content_block_delta(text_delta) → content_block_stop → message_delta → message_stop。断言：拼出完整文本，message_stop 终止。
  2. **thinking + text**：含 thinking_delta 块（须忽略）+ text_delta 块。断言：thinking 不进正文，只有 text_delta 拼出。（对齐 codex 忽略 reasoning 的先例——虽然 codex-provider 实际没有 reasoning 过滤代码，但 anthropic 必须过滤 thinking_delta）。
  3. **单 tool_use**：content_block_start(tool_use, 给 id/name) → input_json_delta(partial_json 分片) → content_block_stop → message_stop。断言：累积 partial_json 成完整 arguments 串，emit `{type:'tool_call', id, name, arguments}`。
  4. **文本 + tool_use 混合**（对应 Q1 混合轮的入向）：text_delta 块 + tool_use 块。断言：先 emit text 事件，再 emit tool_call。
  5. **多 tool_use 并行**（多个 content_block index）：两个 tool_use 块交错 input_json_delta。断言：按 index 分别累积，按 index 顺序 emit（对齐 codex 攒批 emit，codex-provider.ts:196-205）。
  6. **ping 事件**：中途插入 `event: ping`。断言：忽略不影响解析。
  7. **中断/abort**：signal abort 中途。断言：抛 AbortError，与 codex signal 语义对齐（codex-provider.ts:72 signal 透传）。
  8. **错误事件**：`event: error`（anthropic 会发 error 事件带 message）。断言：转成 throw（对齐 codex 的 `throw new Error(...status)`，codex-provider.ts:74-76）。
- **bigmodel vs 官方差异点**（测试要覆盖两者的宽容度）：
  - bigmodel 双认证头都过（Q4）——测试探针端点时两种头都测。
  - bigmodel 是否发全部事件类型（ping？message_delta 带 usage？）——**建议 fixture 以官方规范为准（更全）**，因为解析器要对官方也工作；bigmodel 若少发某些事件（如 ping），解析器不依赖它们即可（忽略式处理，缺了不报错）。
  - **告警**：Hub 探针是对 bigmodel 实测，官方 Anthropic 的 SSE 可能有 bigmodel 没有的字段（如 message_delta 的 stop_reason='max_tokens' —— 这正是 Q2 截断的信号，解析器应能识别并可选地告知截断）。fixture 应包含 `stop_reason:'max_tokens'` 的 message_delta，验证截断可检测。

> CONFIRM；最小充分集 8 条 fixture（纯文本/thinking/单tool/混合/多tool并行/ping/abort/error）；以官方规范为 fixture 基准（更全），bigmodel 宽容度另测；补 stop_reason='max_tokens' fixture 关联 Q2 截断检测。

---

## Q6 — 探针端点协议分流实现点

**裁决：CONFIRM 需要分流；最小改法 = 按解析后的 provider.name 选路径+头，settings.ts:37-69 局部改。**

- 实证当前 test 端点**硬编码**（settings.ts:37-69）：
  - 路径硬编码 `${baseUrl}/chat/completions`（settings.ts:49）。
  - 认证硬编码 `authorization: Bearer`（settings.ts:53）。
  - body 硬编码 openai 形状 `{model, max_tokens:1, messages:[{role:'user',content:'ping'}]}`（settings.ts:55）——**注意：这里已经发了 max_tokens:1**，说明 R23 时已考虑 anthropic 兼容性（openai 忽略多余的 max_tokens，anthropic 需要它）。
- 最小改法：
  - 在 test handler 里读 `app.deps.settings.getProviderConfig().provider`（或从 parsed body 若允许测未保存的 provider——**但 provider 切换需要保存后才有 env 链，测未保存 provider 意义不大，建议用已保存的 provider.name**）。
  - provider === 'anthropic' → 路径 `${baseUrl}/v1/messages`、头加 `anthropic-version: 2023-06-01` + 按 Q4 的认证头、body 是 anthropic 形状 `{model, max_tokens:1, messages:[{role:'user',content:'ping'}]}`（anthropic messages body 与 openai 巧合相似，但要确认 anthropic 不需要额外必填字段）。
  - provider === 'codex' → 现状不变。
- **复用**：认证头逻辑应与 anthropic-provider 的认证逻辑**共用一份**（Q4 的分头逻辑）——否则探针和真实请求认证方式分叉，测出来通过但真实请求失败。建议 anthropic-provider 导出一个 `buildAnthropicHeaders(config)` 或探针直接构造 provider 实例发一个 max_tokens:1 的探针。**最诚实的做法：探针复用 provider 的请求构造**，而非 settings.ts 里再手写一份 anthropic 请求（R16㉑ 重复实现教训）。
- 错误分类沿用（settings.ts:61-65 的 401/403→auth、404→not-found、其它→http-error），anthropic 端点错误码语义一致，可复用。

> CONFIRM；最小改法：test handler 按 provider.name 分流路径+头+version，认证头逻辑与 anthropic-provider 共用（勿手写第二份，R16㉑）；错误分类复用现状。

---

## Q7 — 范围边界确认

**裁决：CONFIRM 边界正确，但一处需澄清（settings-repo 是否算"动"）。**

- 不做 provider 自动探测：CONFIRM。owner UI 一次性选择，隐式魔法（自动探测环境有 ANTHROPIC_* 就切）会造成"我没选却变了"的困惑——否决正确。
- 不做预设：CONFIRM。同 R23。
- 不动 codex-provider.ts：CONFIRM 且**必须守住**（stop condition）。anthropic-provider 是**新文件**，codex 路径逐字节不变，保证 R23 codex 回归绿。
- 不动 answer-service：CONFIRM（Q1 已证适配器模式使 service 零改动可行）。**这是 stop condition，若 coder 发现必须改 answer-service 才能翻译某形状 → blocker**。Q1 已排除此风险，但 coder 实做时若遇到未枚举形状，须停等。
- **澄清点**：本轮**必然要动 settings-repo.ts**（Q3 的 provider-aware env 重构）、**settings.ts**（Q6 探针分流）、**registry.ts**（anthropic 分支）、**SettingsPanel.tsx**（下拉两项）、**deps 类型**（provider 联合类型）、**新增 anthropic-provider.ts + 测试**。契约的"禁碰生产源码"是对 plan（我）说的；coder 的写权白名单必须显式含这些文件。**范围边界对，但要区分"plan 只读"与"coder 的写权清单"**——后者必须列全上述 6 类文件，否则 coder 会因白名单缺失发 blocker（R20 教训）。
- **shared 类型是否大改**（stop condition）：核查——ToolEvent/ToolSchema/Provider 接口（types.ts）**无需改**（anthropic-provider 实现同一 Provider 接口）。ChatMessage（assemble.ts）**无需改**（翻译在 provider 内消费现有形状）。**不触发"shared 类型大改"stop condition**。✓

> CONFIRM 边界；澄清：coder 写权白名单须显式含 settings-repo/settings.ts/registry/SettingsPanel/deps/新 provider 6 类，避免白名单缺失 blocker。shared 类型零改动，stop condition 不触发。

---

## Q8 — 测试面最低清单

**裁决：CONFIRM 五层覆盖；给出清单，其中 R23 codex 回归 + 混合轮翻译是必做锁。**

**A. anthropic-provider 翻译单测（新建 anthropic-provider.test.ts）：**
1. 出向：system 消息 → 顶层 system 参数；**多条 system 聚合**（Q1 警告）。
2. 出向：user/assistant 纯文本 → content 文本块。
3. 出向：**assistant text+tool_calls 混合轮 → content=[text 块, tool_use 块]**（Q1 核心，roundText 非空）。
4. 出向：连续 role:'tool' 消息 → 聚合到一个 user 的 tool_result 数组。
5. 出向：中途 system（轮数上限提示）→ 合并顶层或降级 user（Q1 隐蔽形状）。
6. 出向：TOOL_SCHEMAS（`{type:'function',function:{name,parameters}}`，fs-tools.ts:217+）→ anthropic `{name, input_schema}`；CREATE_VISUAL_TOOL_SCHEMA 同样（create-visual.ts:7-11）。
7. max_tokens：默认值发送；VIBE_LLM_MAX_TOKENS 覆盖（Q2）。
8. 认证头：按来源分头（AUTH_TOKEN→Bearer，API_KEY→x-api-key，Q4）。

**B. SSE 解析单测（fixture 事件流，Q5 的 8 条）：**
9-16. 纯文本/thinking忽略/单tool/文本+tool混合/多tool并行/ping忽略/abort/error——见 Q5。

**C. registry 单测（registry.test.ts 扩）：**
17. provider='anthropic' → createAnthropicProvider；provider='codex' → codex（回归）；其它 → ProviderConfigError（F6 语义不变，registry.ts:21-23）。

**D. settings-repo env 链单测（settings-repo.test.ts 扩，provider-aware）：**
18. **R23 回归**：codex 下只读 VIBE_LLM_*，**不读 ANTHROPIC_***（防误捡回归，Q3 必做）。
19. anthropic 下：baseUrl VIBE_LLM_BASE_URL > ANTHROPIC_BASE_URL > null。
20. anthropic 下：model VIBE_LLM_MODEL > ANTHROPIC_DEFAULT_OPUS_MODEL > 默认。
21. anthropic 下：apiKey VIBE_LLM_API_KEY > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > null。
22. getProviderSources 在 anthropic 下回显正确变量名（ANTHROPIC_*，Q3 徽标）。
23. **注入干净 env `{}` 隔离**（R23 已建立此模式，settings-repo.test.ts 现有用例复用）。

**E. 探针端点单测（settings.test.ts 扩，providerFetch 注入）：**
24. anthropic provider → 探针打 `/v1/messages` + version 头 + 正确认证头（断言 fake fetch 收到的 URL/headers）。
25. codex provider → `/chat/completions`（回归，settings.test.ts 现有用例）。
26. 错误分类复用（401→auth 等）。

**F. web 组件（SettingsPanel.test.tsx 扩）：**
27. 下拉两项（codex/anthropic）；选 anthropic → 徽标显示 ANTHROPIC_* 变量名（sourceBadge，SettingsPanel.tsx:147-152）。
28. PUT 接受 provider='anthropic'（parseUpdate 校验，settings.ts:14-20 allowedKeys 已含 provider，值校验为 string 即可，无需白名单枚举——但**建议加 anthropic/codex 白名单**防脏值）。

**G. Hub 浏览器 e2e：** owner 真实场景——选 anthropic、徽标显示 ANTHROPIC_BASE_URL/AUTH_TOKEN/OPUS_MODEL、测试连接 ✓、真实生成一篇笔记走 /v1/messages 成功。

> CONFIRM 五层；#3（混合轮）/#5（中途system）/#18（codex 不读 ANTHROPIC_* 回归）/#24（探针分流）是针对本审计发现的必做锁。

---

## 数据与流程安全复核（停止条件自检）

- **不触发"必须改 answer-service"**：Q1 已证所有消息形状可在 provider 层翻译（含混合轮/连续tool/多system）。**但 coder 实做若遇未枚举形状 → 必须 blocker**（契约保留此停止条件）。
- **不触发"必须动 codex-provider 或 shared 大改"**：anthropic-provider 是新文件；Provider/ToolEvent/ChatMessage 接口零改动（types.ts/assemble.ts 实证）。
- **不触发"破坏 R23 codex 回归"**：**前提是 Q3 的 provider-aware 重构正确隔离**——codex 下必须只读 VIBE_LLM_*。测试 #18 是这条 stop condition 的守卫。**若 coder 的重构导致 codex 下也读了 ANTHROPIC_* → 就是 R23 回归 → blocker。**
- **key 泄露**：探针端点已有"不读上游 body"防泄露（settings.ts:58-59）；anthropic 探针须沿用（错误分类只用 status，不回显 body）。认证头含 key，禁入日志（R23 铁律延续）。
- **SSRF**：探针打 config.baseUrl，由用户配置决定，与 R23 同（不扩大面）。anthropic 端点同理。
- **仓库状态**：R22/R23 均已落盘（git status 实证 folders.ts/settings env 链在场），与 TASK.md 演进一致，无严重不符。

---

## 给 Hub 的放行建议（结论）

**方案可做，适配器模式正确。放行 coder 前，契约必须补写以下硬约束**：

1. **[必须·Q1] 翻译器 3 个非平凡点显式验收**：(a) assistant text+tool_calls 混合 content（roundText 非空）；(b) 连续 tool_result 聚合到 user；(c) 多条/中途 system 聚合到顶层 system。缺一则"零 service 改动"以漏形状反噬。
2. **[必须·Q3] env 重构是 provider-aware，非加几行**：改造 resolveField/getProviderSources 签名；**codex 下只读 VIBE_LLM_*、不读 ANTHROPIC_***（测试 #18 守卫，防 R23 误捡回归）。
3. **[必须·Q4] 认证按来源分头**（AUTH_TOKEN→Bearer，API_KEY→x-api-key），不用双头（sourceVar 信息已存在，增量小；双头赌端点宽松，官方风险）。次选单 x-api-key。
4. **[必须·Q2] max_tokens 给足默认（32768）+ VIBE_LLM_MAX_TOKENS 覆盖**，provider 内部从 config 读；文档化 vs codex 无上限的差异（截断是真实回归）。
5. **[必须·Q6] 探针认证/请求构造与 anthropic-provider 共用一份**（勿在 settings.ts 手写第二份 anthropic 请求，R16㉑）。
6. **[必须·Q7] coder 写权白名单显式列 6 类文件**：新 anthropic-provider.ts、registry.ts、settings-repo.ts、settings.ts、SettingsPanel.tsx、deps 类型——避免白名单缺失 blocker（R20 教训）。

**范围**：Q7 边界正确（不做探测/预设，不动 codex-provider/answer-service/shared 类型）；stop conditions 均未触发（前提是 Q3 隔离正确）。零数据风险（新 provider + provider-aware 读取，codex 路径不变）。零生产代码改动（本报告）。

切换/回退触发器：若"按来源分头认证"（Q4）在 coder 实做时引出 env 链记忆来源的过度复杂，回退 = 单 `x-api-key`（官方标准，bigmodel 探针实测也过），放弃 Bearer 支持——代价是纯 OAuth token 场景不可用，但 owner 的 bigmodel key 走 x-api-key 可用。此为 fallback。
