# Round 23 · plan 反证审计：Provider 配置简化（环境变量兜底 + 来源显示 + 测试连接）

- 日期：2026-09-13
- 角色：plan（聚焦反证，只读，零生产代码改动）
- 审计对象：Hub 设计草案（contracts/plan.md §「Hub 设计草案」）
- 方法：全部裁决基于当前仓库源码取证（file:line）+ 运行时实证（env 快照 / 消费面枚举）。

## 摘要（TL;DR）

方向**正确且是 owner 真实痛点的对症解**（owner shell 已有 `GLM_API_KEY`，但 `getProviderConfig` 纯读 DB，settings-repo.ts:34-41，env 一概不认）。三件功能都可做，但**放行前必须处理 4 个问题**：

1. **[BLOCKER-级测试回归]** 本机 env **确实有 `GLM_API_KEY`**（运行时实证）。现有 `settings-repo.test.ts:11` 断言全新 repo `apiKey: null`。草案的 env 兜底若默认读 `process.env`，**这条测试在任何设了该变量的开发机/CI 上立即变红**。Q2 的隔离不是"锦上添花"，是**必须先解决**否则 coder 一交付就挂。
2. **[CHALLENGE 命名]** 兜底链吃厂商裸名 `GLM_API_KEY` 有"意外捡到无关 key"的真实风险（本机同时有 7 个 `*_API_KEY`）。建议**默认只认 `VIBE_LLM_*` 命名空间**，`GLM_API_KEY` 作为**显式 opt-in**（或至少来源徽标强提示"正在使用外部变量 GLM_API_KEY"）。
3. **[CHALLENGE 端点形状]** `/api/settings/test` 的"半覆盖 body"语义有歧义（"没传"vs"传了空串清空"分不清）。给出更诚实的形状。
4. **[Q6 必须落地]** 长驻 server 的 env 快照问题**真实存在**（index.ts:1-11 启动时读一次，tsx watch 不重读 shell profile）。设计**必须**在面板上提示"环境变量在服务启动时快照，改后需重启服务"，否则 owner 改了 `~/.zshrc` 发现没生效会二次困惑——正是本轮要消除的那类困惑。

逐条裁决如下。

---

## Q1 — 兜底链设计 + 接受 `GLM_API_KEY` 厂商变量名

**裁决：CONFIRM 兜底链的「DB 优先→env→默认」骨架；CHALLENGE 无条件吃 `GLM_API_KEY` 裸名。**

### 骨架正确
- 现状 `getProviderConfig`（settings-repo.ts:34-41）：`apiKey: get('provider.apiKey') ?? null` —— **纯 DB，零 env**。owner shell 的 `GLM_API_KEY` 完全够不着。这是 owner 抱怨"配置复杂"的根：明明环境里有，却要在 UI 里再填一遍。
- 草案兜底链（DB 非空 → env → 默认）方向对，且"空串视为未设置"这条**必要**：实证 `get()` 直接返回 DB 原值（settings-repo.ts:20-25），DB 里若存了 `''`（owner 保存过空表单，settings.ts:48-49 `if (value !== undefined) set(...)` 会把空串写进去），当前 `'' ?? null` = `''`（`??` 只挡 null/undefined），于是 apiKey 变空串而非走兜底。**草案 item「空串视为未设置」是对既有 `??` 语义 bug 的修正，必须做**，且要用 `.trim()` 非空判断（对照 getVaultPath 已有先例 settings-repo.ts:48-51 `value && value.trim() ? ... : null`）。

### CHALLENGE：`GLM_API_KEY` 裸名兜底有真实误捡风险
- **运行时实证**：本机 `env | grep API_KEY` 命中 **7 个**：`GLM_API_KEY`、`RELAY_API_KEY`、`MIXIANG_IMAGE_API_KEY`、`MIDSCENE_MODEL_API_KEY`、`GEMINI_API_KEY`、`ZECTRIX_API_KEY`、`MIDSCENE_PLANNING_MODEL_API_KEY`。厂商变量名是**全局共享命名空间**，被其它工具设置的概率高。
- 风险场景：owner（或未来别的用户）机器上 `GLM_API_KEY` 是给另一个工具配的、指向另一个端点的 key。应用默默捡来配 `baseUrl=api.openai.com`（草案 baseUrl 默认）发探针 → 401，用户完全不知道 key 是从哪儿捡的。
- **建议**：
  - **默认只认 `VIBE_LLM_API_KEY`**（应用私有命名空间，不会误捡）。
  - `GLM_API_KEY` 若要支持（owner 明说用了 alias/接了 GLM），**必须在来源徽标里显式回显变量名**（草案 item「env 生效时提示变量名」已含此意——那就把它作为硬要求：凡是走非 `VIBE_LLM_*` 的兜底，UI 必须显示"⚠ 使用外部环境变量 GLM_API_KEY"）。这样"意外捡到"至少是**可见的**，用户能一眼看出并纠正。
  - 兜底顺序建议：`VIBE_LLM_API_KEY` → `GLM_API_KEY`（草案的顺序对，DB 之后 VIBE 优先于 GLM 也对）。保留但让它可见。

> CONFIRM 骨架 + 空串修正；CHALLENGE 无声吃 `GLM_API_KEY`——要么只认 VIBE_LLM_*，要么强制来源徽标回显外部变量名（后者是最小改动，且服务 owner 的真实 alias 场景）。

---

## Q2 — settings-repo env 注入设计 + 测试隔离

**裁决：CONFIRM env 注入与 Clock 先例一致；但 CHALLENGE「测试会不会被破坏」——不是"会不会"，是【一定会】，本机实测坐实。**

### 注入设计与先例一致 ✓
- Clock 注入先例：`createTreeRepo(db, clock)`（tree-repo.ts:6）、`createDeps({ clock ?? systemClock, ... })`（deps.ts:42）——默认值 + 可覆盖，纯净可测。
- 草案「createSettingsRepo 增 env 参数默认 process.env」与之同构，**设计对**。签名建议 `createSettingsRepo(db, env: NodeJS.ProcessEnv = process.env)`，deps.ts:45 `createSettingsRepo(options.db)` 保持不变（默认 process.env），测试传 `{}` 或显式 fixture。

### CHALLENGE：现有测试【必然】被破坏，不是风险是事实
- **运行时实证**：本机 `env` 含 `GLM_API_KEY=<有值>`。
- 现有 `settings-repo.test.ts:6-13`：
  ```ts
  const settings = createSettingsRepo(openMemoryDb())   // 默认 process.env
  expect(settings.getProviderConfig()).toEqual({
    apiKey: null, baseUrl: null, model: DEFAULT_PROVIDER_MODEL, provider: 'codex',
  })
  ```
  一旦 `getProviderConfig` 默认从 `process.env.GLM_API_KEY` 兜底，这条断言变成 `apiKey: '<真实key>'` ≠ `null` → **红**。且这不是 CI-only，**任何设了 `GLM_API_KEY` 的开发机**（如 owner 本机、我这台）跑 `pnpm test` 都红。
- **同源风险**：settings.test.ts 的 settingsView 断言（settings.ts:22-32 `hasApiKey: Boolean(config.apiKey)`）——如果 env 有 key，`hasApiKey` 从 false 变 true，settings 路由测试也可能连坐。
- **隔离方案（coder 契约必须写明）**：
  1. **所有断言"无 key"的既有测试**，改为显式注入干净 env：`createSettingsRepo(db, {})`（settings-repo.test.ts 的 default 用例 + settings.test.ts 经 createDeps 的路径需要 deps 也能透传 env——**检查 createDeps 是否需要加 env 参数**，deps.ts:42 createDeps options 里加可选 env，默认 process.env，测试传 `{}`）。
  2. **新增** env 兜底专项测试：注入 `{ VIBE_LLM_API_KEY: 'x' }` 断言兜底命中；注入 `{}` 断言回落 null。
- **告警**：这条隔离改动会波及 **settings-repo.test.ts + settings.test.ts + 任何经 createDeps 起真实 answer/merge 的测试**（若这些测试进程 env 有 key，且它们断言 provider 行为）。coder 必须跑全量 `pnpm test` 确认无新增红，而非只跑 settings 套件。

> CONFIRM 注入设计；CHALLENGE 隔离——【本机实测确认现有测试必挂】。coder 契约必须：(a) createSettingsRepo/createDeps 加 env 注入参数；(b) 既有"无 key"断言改注入干净 env；(c) 全量 test 回归而非局部。这是本轮最大的落地陷阱。

---

## Q3 — /api/settings/test 端点形状

**裁决：CHALLENGE 半覆盖 body 的歧义；建议明确"未提供=用生效值，提供空串=视为清空后走兜底"，并与既有 PATCH 语义对齐。**

### 半覆盖 body 的歧义
- 草案：body `{baseUrl?, model?, apiKey?}`，"提供的值参与兜底链合成，未提供的用 DB/env"。目的是让前端能测**未保存的表单值**——目的正当（对照 SettingsPanel 表单 state baseUrl/model/apiKey 是本地 state，SettingsPanel.tsx:38-40，保存前不落 DB）。
- 歧义点：**"未提供"与"提供了空串"如何区分**？
  - 前端表单里 apiKey 空（用户没改，占位符"已设置留空保持不变"，SettingsPanel.tsx:194）——此时前端应该**不传 apiKey**（让后端用 DB/env 的），还是**传空串**？
  - 若前端传 `apiKey: ''`，后端把空串当"清空"→走 env 兜底，可能测出的是 env 的 key 而非用户以为的 DB key。若前端不传，后端用 DB→env。两条路径结果可能不同，用户不知道测的到底是哪个 key。
- **既有 PATCH 语义参照**（settings.ts:36-53）：PUT 用 `if (value !== undefined) set(...)`——**只有显式提供才写**，未提供保留原值。这是清晰的"undefined=不动"契约。test 端点应**继承同一契约**：`undefined` = 用生效值（DB→env 兜底），提供的字符串（含空串）= 用这个值参与合成（空串再走兜底）。

### 更诚实的形状建议
- **方案 A（推荐，最小歧义）**：test 端点**只接受"最终探针参数"或"表单原始值 + 明确的合成规则"**。具体：前端传 `{baseUrl, model, apiKey}` 三个值，语义 = "这就是我要测的值"；**空串/缺失由前端负责决定是否用生效值**（前端本来就持有 hasApiKey/baseUrl/model 的生效值，SettingsPanel.tsx:51-56）。后端**不做兜底合成**，只做：`apiKey` 为空 → 从 DB→env 取（这一步后端做，因为前端拿不到明文 key，SettingsView 只回 hasApiKey 布尔，types.ts:32）。即：**只有 apiKey 需要后端兜底（因为前端没有明文），baseUrl/model 前端全权决定**。
- 这样契约清晰：`baseUrl/model` = 前端传什么测什么；`apiKey` = 前端传了就用、没传/空则后端按兜底链取。歧义收敛到一个字段且有明确理由（key 明文不下发）。
- **反对全量必传**：baseUrl/model 前端有，但 apiKey 前端永远没有明文（只有 hasApiKey 布尔），全量必传做不到。

> CHALLENGE：半覆盖对，但要写死契约——`baseUrl/model` 前端全权（传什么测什么），`apiKey` 唯一需后端兜底字段（前端无明文）。与 PUT 的"undefined 不动"语义对齐。禁止让"空串 vs 未提供"产生不同兜底路径的隐式分叉。

---

## Q4 — 来源上报响应形状

**裁决：CONFIRM sources 平铺够用；CHALLENGE「生效值预览」——baseUrl/model 可给明文，apiKey 一律不给（连尾 4 位都不给）。**

- **sources 平铺形状**（`sources: {apiKey:'env', baseUrl:'settings', model:'default'}`）足够渲染徽标。前端徽标需要两条信息：(1) 来源枚举（设置/环境变量/默认值/未配置）、(2) env 来源时的变量名。**建议 sources 值不是裸字符串而是对象**：`{apiKey: {source:'env', envVar:'GLM_API_KEY'}, ...}`——这样徽标能直接渲染变量名（Q1 要求的强提示），不用前端再猜是哪个变量。
- **既有响应**：settingsView（settings.ts:22-32）已回 `hasApiKey: Boolean` + baseUrl/model/provider 明文。sources 是**新增字段并列**，不破坏既有形状（SettingsView type types.ts:30-37，前端加字段兼容）。
- **生效值预览裁决**：
  - `baseUrl` / `model`：**可给明文**。它们本来就在 SettingsView 里回传明文（settings.ts:25/28），不敏感。sources 无需重复给，前端已有 baseUrl/model state。
  - `apiKey`：**一律不给，连尾 4 位都不给**。理由：
    1. 现有铁律是 `hasApiKey` 布尔（settings.ts:24），从不下发 key 任何片段。草案 item「绝不回传 env 读到的 key 明文」——**尾 4 位也是明文片段**，破例即开口子。
    2. 尾 4 位对"确认是不是这个 key"帮助有限，但泄露风险实在（日志/截图/分享）。
    3. 用户要验证 key 对不对，**正确工具是"测试连接"按钮（Q5）**，不是回显片段。测试连接能给出"鉴权成功/失败"，比尾 4 位有用得多。

> CONFIRM 平铺 + 建议 source 带 envVar 名；CHALLENGE 预览——baseUrl/model 前端已有无需 sources 重复，apiKey 零片段下发（尾 4 位也不行，用测试连接代替验证）。

---

## Q5 — 探针分类映射 + 10s 超时

**裁决：CONFIRM 分类骨架 + 10s；补充真实端点错误形状与既有 codex-provider 的一致性要求。**

- **既有 codex-provider 错误形状**（复用先例）：`fetchImpl` 注入（codex-provider.ts:52-55 `fetchImpl: FetchImpl = fetch`）——草案「fetch 可注入」与此**完全同构**，✓。codex-provider 对失败的处理是 `throw new Error('...failed with status ${response.status}')`（codex-provider.ts:74-76）——探针可复用同样的 status 提取，但要**分类映射为中文**（草案要求）。
- **分类映射覆盖核查**：
  - 网络不可达（DNS 失败/连接拒绝）：`fetch` 抛 `TypeError`（非 HTTP status）→ 归"网络不可达"。✓ 草案有。
  - 鉴权 401/403 → "鉴权失败"。✓
  - 404/400 → "端点或模型不存在"。**告警**：真实端点行为分叉——bigmodel paas v4（智谱）模型名错常返 **400** + body 里带 error message；OpenAI 兼容端点模型不存在可能 404 或 400。草案把 404/400 合并为一类是**合理简化**，但**建议探针把原始 status + response body 的 error.message（若有）附在 reason 里**（截断，不含 key），因为"model 不存在"和"baseUrl 路径错"都可能 404/400，附原始信息帮 owner 自诊。
  - 超时 → AbortSignal 触发，抛 AbortError → 归"超时"。✓
  - 其它 → 附原始 status。✓
- **10s 超时**：**CONFIRM 合适**。对照前端既有 `SETTINGS_REQUEST_TIMEOUT_MS = 10_000`（SettingsPanel.tsx:6）——同值，一致性好。1-token 探针（max_tokens:1，非流式）响应应在数秒内，10s 有余量。**告警**：探针超时（10s）应短于或等于前端对该请求的超时，避免前端先超时后端还在跑。建议后端 AbortSignal 10s、前端对 test 请求也用同一 withTimeout（SettingsPanel.tsx:10-26 已有该工具，可复用）。
- **F6 一致性**（错误层复用，R16㉒/F6 教训）：现有 provider 配置错误走 `503 + {code:'PROVIDER_CONFIG', error}`（answer.ts:29-31 实证）。测试连接的失败**不应**复用 503（那是"配置无法解析"），而是 `200 + {ok:false, reason}`——因为"能发探针但对端拒绝"是**业务结果非服务器错误**。这个区分要写清：**test 端点永远 200（除非 body 非法 400），成败在 body 的 ok 字段**。这样前端只需读 ok，不用区分 HTTP status 层。

> CONFIRM 分类 + 10s；补充：附原始 status+error.message（截断无 key）助自诊；test 端点成败走 body.ok 而非 HTTP status（区别于 F6 的 503 配置错误）；前后端超时对齐复用 withTimeout。

---

## Q6 — 进程环境快照问题

**裁决：CONFIRM 问题真实存在，且【必须在设计内处理】，不能全留给 Hub 验收。**

- **实证**：server 入口 index.ts:1-11 —— `openDb` → `createDeps` → `buildApp` → `listen`，**启动时读一次 env**。tsx watch（dev）只在**源文件**变化时重启，**不重读 shell profile**——owner 改 `~/.zshrc` 后，已运行的 server 进程 env 是启动时的快照，不会更新。
- 为什么必须处理：本轮的**全部目的**是消除 owner"配置复杂/困惑"。如果 owner 按新功能去 `~/.zshrc` 设了 `VIBE_LLM_API_KEY`，回到面板发现来源还显示"未配置"（因为 server 没重启），**这是新增的、更隐蔽的困惑**——比原问题更糟（原问题至少 UI 里能填）。
- **设计内必须包含**（最小成本）：
  1. **面板提示**：来源徽标显示"环境变量"时，附一行说明"环境变量在服务启动时读取，修改后需重启服务生效"。纯文案，零逻辑成本。
  2. （可选加分）测试连接失败/来源为空时，提示"若刚改了环境变量，请重启本地服务"。
- **不建议**：为解决快照问题去做 env 热重载（重读 profile 需要 spawn shell，复杂且脆弱，超范围）。**文案提示是诚实的最小解**。
- Hub 验收侧：Hub 重启 server 使 env 生效属于运维动作，但**面板文案是产品的一部分**，必须 coder 落地，不能只靠 Hub 口头验收时说明。

> CONFIRM 问题真实；裁决【设计内处理】——面板文案提示"env 服务启动时快照，改后需重启"是硬要求（否则制造新困惑）。热重载超范围不做。

---

## Q7 — 范围边界

**裁决：CONFIRM 不越界。**

- 不做预设下拉（智谱/内网预设）：CONFIRM。当前 provider 是 codex-only 硬编码（SettingsPanel.tsx:173-176 `<select>` 只有 codex 一项；registry.ts:21 非 codex 抛错）。加预设下拉要改 provider 解析层，超范围。
- 不做 Anthropic 协议 provider：CONFIRM。provider 层只有 codex/mock（provider/ 目录实证：codex-provider.ts + mock-provider.ts + registry.ts）。加 Anthropic 协议要新 provider 实现 + 协议层改造，明确越界（触发 stop condition"必须动 provider 协议层"）。
- 本轮三件（env 兜底 / 来源显示 / 测试连接）**都不碰 provider 协议层**：env 兜底在 settings-repo（配置读取层），来源显示在 settings 路由 + 前端，测试连接是独立探针端点。**全部在配置层与展示层，provider 协议层零改动**——符合 stop condition 不触发。

> CONFIRM 边界正确，三件功能均不下探到 provider 协议层。

---

## Q8 — 测试面最低清单

**裁决：CONFIRM 需要三层覆盖；给出具体清单，其中 env 隔离改造是前置必做。**

**A. 前置（Q2，必须先做否则全红）：**
0. createSettingsRepo/createDeps 加 env 注入参数；既有"无 key"断言（settings-repo.test.ts:6-13、settings.test.ts 相关）改注入干净 env `{}`。**改完先跑全量 `pnpm test` 确认基线回绿**，再加新功能。

**B. server env 兜底单测（settings-repo.test.ts 扩）：**
1. DB 有 apiKey → 用 DB 值（env 也有时 DB 优先）。
2. DB 空 + `env.VIBE_LLM_API_KEY` 有 → 用 env，来源 'env'。
3. DB 空 + env 空 → null，来源 'unset'。
4. DB 存空串 `''` → 视为未设置走兜底（回归 `??` bug 修正）。
5. baseUrl 兜底：DB→VIBE_LLM_BASE_URL→null。
6. model 兜底：DB→VIBE_LLM_MODEL→DEFAULT_PROVIDER_MODEL。
7. `GLM_API_KEY` 兜底命中时来源对象含 `envVar:'GLM_API_KEY'`（Q1 可见性）。

**C. test 端点单测（新建 settings-test.test.ts，fake fetch 注入）：**
8. fake fetch 返回 200 → `{ok:true, model, latencyMs}`。
9. fake fetch 返回 401 → `{ok:false, reason:'鉴权失败...'}`。
10. fake fetch 返回 404/400 → `{ok:false, reason:'端点或模型不存在...'}` + 原始 status。
11. fake fetch 抛 TypeError（网络）→ `{ok:false, reason:'网络不可达'}`。
12. AbortSignal 超时 → `{ok:false, reason:'超时'}`。
13. body 传未保存的 baseUrl/model → 探针用传入值（断言 fake fetch 收到的 URL/body）。
14. apiKey 不传 → 后端从 DB/env 取（断言 Authorization header 用了兜底 key，但**测试里断言 header 存在即可，不断言明文**）。
15. **禁 key 入日志**：断言探针失败时 reason 不含 key（可扫 reason 字符串）。

**D. web 组件测（SettingsPanel.test.tsx 扩）：**
16. sources 各值 → 徽标渲染正确文案（设置/环境变量/默认值/未配置）。
17. env 来源 → 徽标显示变量名。
18. 测试连接按钮：点击 → 进行中禁用；成功 → ✓+延迟；失败 → ✗+原因。
19. 徽标/预览**不显示 key 任何片段**（回归 Q4）。

**E. Hub 浏览器 e2e（验收）：** owner 真实场景——清空 DB apiKey、shell 有 GLM_API_KEY、面板显示"来自环境变量 GLM_API_KEY"、测试连接 ✓；改 baseUrl 为错值测试连接 ✗ 且原因可读。

> CONFIRM 三层；#0 env 隔离前置是全绿的前提；#14/#15/#19 是"key 不泄露"回归锁必须有。

---

## 复用与错误层核查（R16㉑/㉒ 教训）

- **fetch 注入**：复用 codex-provider 的 `FetchImpl` 先例（codex-provider.ts:52-55），✓ 草案已对齐，勿新造注入方式。
- **超时**：前端复用 `withTimeout`（SettingsPanel.tsx:10-26），勿新写一份。
- **错误层**：test 端点成败走 `body.ok`，与 F6 的 `503 PROVIDER_CONFIG`（answer.ts:29-31，四路由统一）**语义分层**——配置无法解析=503，能测但对端拒绝=200+ok:false。**勿把两者混用**（R16㉒ 错误吞没教训的反面：这里要保持错误语义清晰分层）。
- **sanitize/env 读取**：env 读取是新逻辑，无既有可复用；但要确保**只在 settings-repo 一处读 env**（单一入口），四个消费点（answer/correct/merge/route-converge，全走 resolveProvider→getProviderConfig 实证）自动受益，勿在别处再读 process.env。

---

## 数据与流程安全复核（停止条件自检）

- **消费面枚举**（实证）：`resolveProvider`/`getProviderConfig` 消费点 = answer.ts:23、correct.ts:54、merge.ts:26、route-converge.ts:16，**全部经 `getProviderConfig` 单一入口**（registry.ts:20）。env 兜底改在这一个入口，**四个 AI 流程统一受益、统一风险**——不存在"某个流程绕过兜底"的分叉。
- **兜底会否破坏既有流程？** 不会破坏**逻辑**：兜底只在 DB 为空时补值，DB 有值时行为**逐字节不变**（DB 优先）。但**会破坏既有测试**（Q2，本机实测），那是测试隔离问题非流程逻辑问题——**不触发"破坏 answer/correct/merge 的 provider 解析"stop condition**（解析逻辑不变，只是多了兜底源）。
- **不触发"必须动 provider 协议层"stop condition**：三件功能全在配置层/展示层/独立探针，provider 协议（codex-provider stream/complete）零改动。
- **SSRF 面**：探针 POST 到 `{baseUrl}/chat/completions`，baseUrl 由用户配置决定——**本来就由用户配置决定**（codex-provider.ts:56 同样用 config.baseUrl 发真实请求），探针不扩大 SSRF 面。✓ 草案判断对。**唯一补充**：探针端点应确保 baseUrl 走同一 sanitize/校验（若既有对 baseUrl 无校验，探针也不新增校验面，维持现状即可，不越权加）。
- **仓库状态与 TASK.md 一致**：settings-repo 纯 DB（TASK.md R20 F6 记载 owner 配 provider 走 DB settings），一致。无严重不符。

---

## 给 Hub 的放行建议（结论）

**方案可做，是 owner 痛点的对症解。放行 coder 前，契约必须补写以下硬约束**：

1. **[必须·前置] env 测试隔离**：createSettingsRepo/createDeps 加 env 注入参数（默认 process.env）；既有"无 key"断言改注入 `{}`；**先跑全量 pnpm test 回绿再加功能**。理由：本机实测 `GLM_API_KEY` 已存在，不隔离则 settings-repo.test.ts:11 立即红。
2. **[必须] `GLM_API_KEY` 可见性**：默认只认 `VIBE_LLM_*`；走 `GLM_API_KEY` 等外部变量时，来源徽标**强制回显变量名**（避免无声误捡 7 个 *_API_KEY 之一）。
3. **[必须] env 快照文案**：面板对 env 来源项提示"环境变量在服务启动时读取，修改后需重启服务"。否则制造比原问题更隐蔽的新困惑。
4. **[必须] key 零片段下发**：sources 不含 apiKey 任何片段（尾 4 位也不行）；测试连接代替片段验证。
5. **[必须] 错误语义分层**：test 端点成败走 `body.ok`（200），区别于 F6 的 `503 PROVIDER_CONFIG`；禁 key 入日志/reason。

**端点形状裁决**（供 Hub 拍板）：test body 中 `baseUrl/model` 前端全权（传什么测什么），`apiKey` 是唯一需后端兜底字段（前端无明文），与 PUT 的"undefined 不动"语义对齐，禁"空串 vs 未提供"隐式分叉。

**范围**：Q7 边界正确（不做预设/不做 Anthropic 协议），三件功能均不下探 provider 协议层，stop conditions 均未触发。零数据风险（兜底只补空值，DB 优先逐字节不变）。零生产代码改动（本报告）。

切换/回退触发器：若 env 隔离改造导致大量既有测试连锁红且难收敛，回退方案 = **env 兜底默认关闭**（加 `provider.envFallback` 开关，默认 false，owner 显式开启），把 env 读取从"默认行为"降级为"opt-in 特性"，既解 owner 痛点又不动既有测试基线。此为 fallback，首选仍是正确隔离测试。
