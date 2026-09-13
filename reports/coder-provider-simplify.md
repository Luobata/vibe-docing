# Round 23 · Provider 配置简化交付

日期：2026-09-13。实现者：coder。依据：state/contracts/coder.md（Round 23）。

实现及合同验证完成，交 Hub 验收：**603 → 642 tests（新增 39）**、typecheck、build 均通过。Step 0 按要求先单独完成并跑绿，之后才实现功能。

**真实环境结果需注意**：本轮在浏览器点击一次当前配置的「测试连接」，结果为 **auth**，页面正确显示「✗ 认证失败，请检查 API 密钥。」。这证明真实错误路径已接通，不代表当前真实 provider 连接成功。没有保存/修改 owner 配置或密钥，没有重启服务。

## 行为与范围

- settings-repo 独立接收 env，默认 process.env；只取 VIBE_LLM_API_KEY / VIBE_LLM_BASE_URL / VIBE_LLM_MODEL，在 repo 创建时快照。
- 各字段独立按 DB 非空 → 对应 env 非空 → 默认解析。DB 空串及纯空白视为未设置；DB 非空值保持原样。apiKey 最终 null，baseUrl 最终 null（provider 仍用原有默认），model 最终 DEFAULT_PROVIDER_MODEL。
- GLM_API_KEY、OPENAI_API_KEY 等裸厂商名完全不参与兜底；provider.name 保留原有解析和 codex-only UI，不从 env 读取。
- GET/PUT settings 增加 sources / sourceVars，仅上报来源与变量名称。密钥仍只下发 hasApiKey 布尔，不含明文或尾部片段。
- POST /api/settings/test：baseUrl/model 只测请求传入值，不用服务端保存值替代；apiKey 缺省走解析链，显式传入（含空串）则使用传入值。非流式 ping、max_tokens=1、10 秒 AbortController；不持久化测试参数。
- 探针所有已解析请求的业务结果 HTTP 200，通过 ok/code 区分 invalid-config、unreachable、timeout、auth（401/403）、not-found（404）、http-error（其余错误状态，带 status）。成功返回 model/latencyMs。
- 上游响应正文不读取、不转发，获取状态后取消 body；异常文本不进入响应或日志。新增探针路径无日志调用。
- 设置面板新增来源徽标、env 重启提示、测试按钮及内联成功/失败状态，测试中禁用相关输入与保存/测试按钮，编辑字段后清除过时测试结果。
- baseUrl 为 null 时，面板显示原 provider 的默认地址 https://api.openai.com/v1，探针始终传当前可见值。用户手动将 baseUrl/model 删空后测试，按契约返回 invalid-config；不偷偷读旧 DB 值。
- 保存无关设置时，未编辑的 model/baseUrl 不写入 DB，防止 env/default 值被意外固化为 settings 来源；密钥空输入仍保留「不改」语义。

无新依赖、无 provider 协议层改动；R20 渲染及 R22 文件夹改动保留。未提交、推送、部署、杀进程或重启服务。

## Step 0 顺序证据

首先仅修改 settings-repo 的 env 参数、deps 的透传，以及 settings-repo/settings 路由/deps 的既有测试注入 env:{}；未改变任何既有断言，也未实现兜底或新端点。随后运行：

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
```

exit 0，日志 /tmp/r23-step0-tests.log：

```text
packages/shared test:  Test Files  7 passed (7)
packages/shared test:       Tests  34 passed (34)
packages/shared test:    Start at  14:51:02
packages/server test:  Test Files  54 passed (54)
packages/server test:       Tests  229 passed (229)
packages/server test:    Start at  14:51:03
packages/web test:  Test Files  46 passed (46)
packages/web test:       Tests  340 passed (340)
packages/web test:    Start at  14:51:03
```

14:53 的 relay progress 已报告 Step 0 通过后才开始功能。没有触发隔离连锁失败或 opt-in fallback；本轮无 blocker。

## 当前运行验证

环境：Node 22.21.1 / pnpm 10.33.0。

```sh
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r test
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r typecheck
PATH=/Users/bytedance/.nvm/versions/node/v22.21.1/bin:$PATH pnpm -r build
```

均 exit 0。全量日志：/tmp/r23-tests.log、/tmp/r23-typecheck.log、/tmp/r23-build.log。

| 包 | Step 0 / 基线 | 功能完成后 |
| --- | ---: | ---: |
| shared | 34 | 34 |
| server | 229 | 256 |
| web | 340 | 352 |
| 总计 | 603 | **642** |

```text
packages/shared test:  Test Files  7 passed (7)
packages/shared test:       Tests  34 passed (34)
packages/shared test:    Start at  15:01:15
packages/server test:  Test Files  54 passed (54)
packages/server test:       Tests  256 passed (256)
packages/server test:    Start at  15:01:16
packages/web test:  Test Files  46 passed (46)
packages/web test:       Tests  352 passed (352)
packages/web test:    Start at  15:01:16
Scope: 3 of 4 workspace projects
packages/shared typecheck$ tsc --noEmit
packages/shared typecheck: Done
packages/server typecheck$ tsc --noEmit
packages/web typecheck$ tsc --noEmit
packages/server typecheck: Done
packages/web typecheck: Done
```

聚焦：settings-repo 20、deps 2、settings routes 19，合计 server 41/41；SettingsPanel 16/16。

新增 39 项的实质覆盖：

- repo +10：DB/env 优先组合、空串与空白、默认、各字段独立补缺、env 不落 DB、忽略裸厂商变量和 env provider 名、启动时快照及 DB 修改立即生效。
- deps +1：env 与 fake fetch 可注入。
- routes +16：来源及变量名、GET/PUT 不泄露 key/尾4位、未保存 baseUrl/model 实际用于请求、key 的 DB/env/显式/空串语义、测试零 DB 写入、200 成功、401/403/404/400/500 映射、网络错误、真实 AbortSignal 10秒触发、invalid-config 不借用保存参数。上游响应体和抛出的异常带假密钥时，响应仍不含任何密钥片段。
- UI +12：四种徽标与 env 提示、默认端点展示、未保存表单参数、重复点击/busy/成功恢复、编辑后清除旧结果、通过真实 createApi 发送新输入 key 但不保存、无关保存不固化 env、六类中文失败提示、异常不回显、挂起请求超时恢复。

期间发现并修复一个新增测试 mock 的 TypeScript 零参数推断问题；之后的全量 tests/typecheck/build 均在最终代码上运行并通过。既有测试断言未改，只做合同要求的 env:{} 注入。

构建：web 主包 1,064.00 kB / gzip 377.03 kB，构建成功。日志仍有既有 React act 提示和大 chunk 提示，本轮未扩展处理。

## 真实浏览器与运行时证据

CUA / Chrome 独立临时页访问 http://127.0.0.1:5173/，只在规定的 1440×1000、1980×1000 查看布局，均实际检查截图。三个字段徽标为「来自设置」，密码输入为空，没有密钥预览；无横向溢出。

当前 GET /api/settings 筛选后的非秘密字段：

```json
{"sources":{"apiKey":"settings","baseUrl":"settings","model":"settings"},"sourceVars":{},"hasApiKey":true}
```

真实点击「测试连接」一次：测试中模型/地址/密钥输入、测试/保存按钮禁用；结束后恢复，显示认证失败。

```json
{"viewport":1440,"overflow":false,"badges":["来自设置","来自设置","来自设置"],"passwordEmpty":true,"result":"✗ 认证失败，请检查 API 密钥。"}
{"viewport":1980,"overflow":false,"badges":["来自设置","来自设置","来自设置"],"passwordEmpty":true,"result":"✗ 认证失败，请检查 API 密钥。"}
```

未点击保存，未修改真实字段，未重新请求其他端点或替换凭据。结束后还原 viewport override、关闭临时页。结果已通过 relay progress 及时告知 Hub。成功探针、env 来源、env 重启提示由本轮可注入测试覆盖；未通过重启真实服务来改环境做验收。

## 改动概览

本轮 10 个实现/测试文件，另有本报告（workspace 与 state/reports 同步）：

| 路径（省略 packages/） | 本轮变更 |
| --- | --- |
| server/src/repo/settings-repo.ts | +35/-5：注入、快照、解析链及来源 |
| server/src/repo/settings-repo.test.ts | +77/-7：原用例 env:{} 隔离与 +10 |
| server/src/deps.ts | +4/-2：env/providerFetch 注入 |
| server/src/deps.test.ts | +9：隔离与注入验证 |
| server/src/routes/settings.ts | +34：来源扩展与探针 |
| server/src/routes/settings.test.ts | +128/-4：隔离与 +16 |
| web/src/api/client.ts | 本轮 +18/-2：扩展响应类型及 testProvider；对 HEAD 另含 R22 的 +16 |
| web/src/components/SettingsPanel.tsx | +73/-15：来源、测试与保留 env 的保存行为 |
| web/src/components/SettingsPanel.test.tsx | +146：+12 |
| web/src/components/Workbench.css | 本轮只新增 7 行；对 HEAD 另含 R20/R22 的 39 行 |

ProviderSettingsView 在已授权 client.ts 中扩展既有 SettingsView，未改 api/types.ts 或 shared。CSS 本轮仅新增如下规则：

```css
.settings-panel .settings-field-label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.settings-panel .settings-source { padding: 1px 6px; border-radius: var(--r1); background: var(--fill-inset); color: var(--text-3); font-size: 11px; overflow-wrap: anywhere; }
.settings-panel .settings-env-hint { color: var(--text-3); font-size: 12px; line-height: 1.6; }
.settings-panel .settings-test-connection { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
.settings-panel .settings-test-result { margin: 0; color: var(--danger); font-size: 12px; }
.settings-panel .settings-test-result.is-success { color: var(--success); }
```

## 范围与保留证明

当前运行逐文件 SHA-256 对照开工基线，已有 R20/R22 生产文件除本轮授权复用的 client.ts/Workbench.css 外全部一致；Workbench.css 删除上面的新增块后全文与开工时相等，原 R20/R22 CSS 和 pre/code 保护区均未改变。

```json
{
  "changedBaseline": [
    "packages/web/src/api/client.ts",
    "packages/web/src/components/Workbench.css"
  ],
  "protectedR20R22Unchanged": true,
  "cssUnchangedOutsideR23": true
}
```

本轮路径 git diff --check exit 0。没有新增任何其他路径的 process.env 读取；provider/registry、answer/correct/merge、editor、TreeLauncher、folders 等均未修改。

## 取舍与后续注意

- **DB 仍优先**。当前真实配置三项均来自设置，新增环境变量不会覆盖已有非空 DB 值。当前探针认证失败需要 owner/Hub 检查配置凭据；本轮没有代替用户更换或清空。
- 仅支持 VIBE_LLM_*，不读取 GLM_API_KEY，也未新增预设或 Anthropic 协议。环境变量必须被启动本地服务的进程继承；已有服务需重启才能读取新值。
- 成功是轻量 HTTP 探针成功，不覆盖流式生成、工具调用、业务上下文或输出质量。上游错误正文不展示，诊断粒度止于固定错误分类/HTTP status，以避免上游回显秘密。
- 默认 URL 在面板内与现有 codex provider 默认保持一致；协议层本轮禁止改动，因此未提取跨端默认常量。若后续修改 provider 默认地址，应同步该面板默认值。

