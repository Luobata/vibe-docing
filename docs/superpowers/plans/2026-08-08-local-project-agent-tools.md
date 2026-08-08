# 本地项目可读（Agent 只读工具）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 配置本地项目根目录后，模型在回答时按需调用 5 个只读文件工具浏览该目录并据此作答。

**Architecture:** 服务端加安全的只读文件工具（根目录 allowlist + 路径穿越防护）；provider 扩 OpenAI tool-calling；answer-service 把单轮流式改为工具循环；settings 存 `project.root`；web 加最小设置面板。无根目录时退回现有纯对话。

**Tech Stack:** Fastify + better-sqlite3（server，Node 22）；React+TS（web）；vitest。**server 测试须用 Node 22**：`export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"`（better-sqlite3 原生模块）。

## Global Constraints

- server 测试：`export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && pnpm --filter @vibe/server test`；web：`pnpm --filter @vibe/web test`；类型：各自 `exec tsc --noEmit` exit 0。
- 提交中文 `feat:`/`refactor:` 前缀 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 不新增运行时依赖（glob 用 Node 内置能力或手写小匹配；不引入第三方 glob 库）。
- 安全硬要求：路径 `resolve` 后必须仍在 root 内（realpath 后再校验），拒绝 `../` 逃逸；排除 `.git`/`node_modules`/`.env*`/dotfiles；单文件上限 256KB；最大工具轮数 12。
- 无 `project.root` 或校验失败 → 工具不可用，走现有单轮 `stream`，零行为变化。
- 现有 184 测试（web 110 / server 85 起，注：合并后 main 基线）保持通过。

---

## Task 1: fs-tools —— 安全校验 + 5 个只读执行器 + schema/dispatch（纯函数）

**Files:**
- Create: `packages/server/src/tools/fs-tools.ts`
- Create: `packages/server/src/tools/fs-tools.test.ts`

**Interfaces (Produces):**
- `safeResolve(root: string, p: string): string` — 归一化并校验，越界 throw `Error('path escapes project root')`。
- `isExcluded(relPath: string): boolean` — 命中 `.git`/`node_modules`/`.env`(含 `.env.*`)/任一路径段以 `.` 开头 → true。
- `listDir(root, args: { path?: string }): string`
- `readFile(root, args: { path: string }): string`
- `grep(root, args: { pattern: string; path?: string }): string`
- `findFiles(root, args: { glob: string }): string`
- `readLines(root, args: { path: string; start: number; end: number }): string`
- `TOOL_SCHEMAS: Array<{ type:'function'; function:{ name; description; parameters } }>` — 5 个工具的 OpenAI schema。
- `dispatchTool(root: string, name: string, argsJson: string): string` — 按 name 解析 args 调对应执行器；未知 name / 解析失败 → 返回错误串（不 throw）。
- 常量：`MAX_FILE_BYTES = 262144`, `MAX_GREP_HITS = 200`。

- [ ] **Step 1: 写失败测试**（用 `node:fs`/`node:os` 建临时 fixture 目录）

覆盖：`safeResolve` 拒 `../etc`、拒绝对路径 `/etc/passwd`、允许正常子路径；`isExcluded` 命中 `.git/x`、`node_modules/a`、`.env`、`.env.local`、`.secret`；`readFile` 读正常文件、超 256KB→错误串、排除文件→拒绝、不存在→错误串；`listDir` 列目录且不含排除项；`grep` 命中返回 `rel:line:text`；`findFiles` glob `**/*.ts` 命中且不含 node_modules；`readLines` 区间正常 + 越界裁剪；`dispatchTool('read_file', '{"path":"pkg.json"}')` 正常、坏 JSON→错误串、未知 name→错误串。

```ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { safeResolve, isExcluded, readFile, listDir, grep, findFiles, readLines, dispatchTool } from './fs-tools'
// beforeAll: root = mkdtempSync(join(tmpdir(),'fstool-')); write pkg.json, src/a.ts, node_modules/x.js, .env
// ...assertions per above...
```

- [ ] **Step 2: 运行确认失败**

Run: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && pnpm --filter @vibe/server test -- --run src/tools/fs-tools.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 fs-tools.ts**

要点：`safeResolve` 用 `path.resolve(root, p)` 后 `fs.realpathSync` 存在则解析软链，再断言 `resolved === root || resolved.startsWith(root + path.sep)`。`isExcluded` 拆 `relPath.split(path.sep)`，任一段 `=== '.git' || === 'node_modules' || seg === '.env' || seg.startsWith('.env.') || seg.startsWith('.')` → true。`findFiles` 递归遍历（跳过排除目录），把 glob 转正则（`**`→`.*`，`*`→`[^/]*`，转义其余）匹配相对路径。所有执行器对 fs 错误 `try/catch` 返回 `\`错误：<msg>\`` 串（除 safeResolve 越界 throw，由 dispatch 捕获转错误串）。

- [ ] **Step 4: 运行确认通过 + tsc + 提交**

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
pnpm --filter @vibe/server test -- --run src/tools/fs-tools.test.ts && pnpm --filter @vibe/server exec tsc --noEmit
git add packages/server/src/tools/fs-tools.ts packages/server/src/tools/fs-tools.test.ts
git commit -m "feat: 只读文件工具（路径穿越防护/排除/list/read/grep/find/readLines）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: settings 根目录（project.root + 校验 + 路由）

**Files:**
- Modify: `packages/server/src/repo/settings-repo.ts`
- Create: `packages/server/src/tools/project-root.ts` (+ `.test.ts`)
- Modify: `packages/server/src/routes/settings.ts`
- Test: `packages/server/src/routes/settings.test.ts`

**Interfaces:**
- `settings.getProjectRoot(): string | null`（读键 `project.root`，空串→null）。
- `resolveProjectRoot(raw: string | null): { root: string } | { error: string }`（trim；空→error；`path.isAbsolute` 否则 error；`existsSync` 且 `statSync().isDirectory()` 否则 error）。
- `/api/settings` PUT `allowedKeys` 增 `projectRoot` → 存键 `project.root`；GET `settingsView` 增 `projectRoot: config.projectRoot`（明文回显路径 OK；apiKey 仍只回 `hasApiKey`）。

- [ ] **Step 1: 写失败测试**

`settings-repo.test.ts`（若无则建，用 openMemoryDb）：set `project.root` 后 `getProjectRoot` 返回之，未设→null。`project-root.test.ts`：相对路径→error、不存在→error、真实临时目录→`{root}`。`routes/settings.test.ts`（沿用 fork.test.ts 的 app 装配）：PUT `{projectRoot:'/tmp'}`→200，GET 回 `projectRoot:'/tmp'`；GET 不含明文 apiKey。

- [ ] **Step 2–4: 运行失败 → 实现 → 通过**

`settings-repo.ts`：`getProviderConfig` 旁加 `getProjectRoot`（`const v = get('project.root'); return v && v.trim() ? v : null`）。`project-root.ts` 实现纯校验。`settings.ts`：`allowedKeys` 加 `'projectRoot'`；`parseUpdate` 已要求所有值为 string（OK）；PUT values 列表加 `['project.root', parsed.projectRoot]`；`settingsView` 加 `projectRoot: app.deps.settings.getProjectRoot()`。

Run: `export PATH=...v22.../bin:$PATH && pnpm --filter @vibe/server test && pnpm --filter @vibe/server exec tsc --noEmit`

- [ ] **Step 5: 提交** `feat: settings 支持 project.root 与目录校验`

---

## Task 3: provider tool-calling（ChatMessage 扩展 + streamWithTools + codex 实现）

**Files:**
- Modify: `packages/server/src/context/assemble.ts`（`ChatMessage` 类型扩展）
- Modify: `packages/server/src/provider/types.ts`
- Modify: `packages/server/src/provider/codex-provider.ts`
- Modify: `packages/server/src/provider/mock-provider.ts`（加 streamWithTools 便于测试）
- Test: `packages/server/src/provider/codex-provider.test.ts`（若无则建）

**Interfaces (Produces):**
- `ChatMessage` 扩展为可带 `tool_calls?: Array<{ id; type:'function'; function:{ name; arguments } }>`（assistant）和 `role:'tool'` + `tool_call_id: string`（工具结果）。保持现有 `{role,content}` 兼容。
- `ToolEvent = { type:'text'; text: string } | { type:'tool_call'; id: string; name: string; arguments: string }`。
- `Provider.streamWithTools?(messages, tools, options?): AsyncIterable<ToolEvent>`（可选方法；`stream`/`complete` 保留）。

- [ ] **Step 1: 写失败测试**（mock SSE）

`codex-provider.test.ts`：构造一段假 SSE（含 `delta.content` 文本片段 + 分片的 `delta.tool_calls`（index/id/function.name/function.arguments 分多帧）+ `finish_reason:'tool_calls'`），用注入的 `fetchImpl` 返回该流；断言 `streamWithTools` yield 出正确的 text 事件与一个完整聚合的 tool_call 事件（name + 完整 arguments）。

- [ ] **Step 2–4: 失败 → 实现 → 通过**

`codex-provider.ts`：加 `streamWithTools`，请求体加 `tools`（传入的 schema）+ `tool_choice:'auto'`。SSE 解析：`delta.content`→emit text；`delta.tool_calls[i]`→按 `index` 累积 `id`/`function.name`/`function.arguments` 到本地 map；`finish_reason` 到达时把累积的 tool_calls 各 emit 一个 `tool_call` 事件。`createCodexProvider` 支持 `fetchImpl` 注入（便于测试；默认 `fetch`）。`mock-provider.ts` 加一个可脚本化的 `streamWithTools`（按预设序列 yield）。

Run: `export PATH=...v22.../bin:$PATH && pnpm --filter @vibe/server test && ... tsc`

- [ ] **Step 5: 提交** `feat: provider 支持 OpenAI tool-calling（streamWithTools）`

---

## Task 4: answer-service 工具循环

**Files:**
- Modify: `packages/server/src/service/answer-service.ts`
- Modify: `packages/server/src/deps.ts`（`createAnswerService` 注入 `settings`）
- Modify: `packages/server/src/service/answer-service.test.ts`（构造签名 + 循环用例）
- 检查所有 `createAnswerService(` 调用点补 `settings`。

**Interfaces:**
- `createAnswerService({ nodes, segments, versions, settings })`（新增 settings）。行为：`generate` 内解析 `resolveProjectRoot(settings.getProjectRoot())`；有 root 且 provider 有 `streamWithTools` → 工具循环；否则现有单轮 `stream`。

- [ ] **Step 1: 写失败测试**

用 mock provider：脚本化"第 1 轮 emit 一个 read_file tool_call，第 2 轮 emit 最终文本"。注入 settings.getProjectRoot 返回一个临时 fixture 目录。断言：(a) 最终 `ai_response` = 最终文本（不含工具往返）；(b) dispatchTool 被以该 root 调用（可通过 fixture 里放一个已知文件、tool_call 读它、并断言第 2 轮 messages 里出现 role:'tool' 的内容——或 spy dispatch）；(c) 无 root 时走单轮 `stream`（现有用例保持）；(d) 超过 maxRounds 收尾不无限循环（脚本化持续发 tool_call，断言在 12 轮后停止并单轮收尾）。

- [ ] **Step 2–4: 失败 → 实现 → 通过**

实现循环：见 spec 分项 4。system 提示串：`你可以调用工具浏览本地项目根目录：${root}。需要时读取文件后再作答。`。每轮把 assistant(tool_calls) 与各 `{ role:'tool', tool_call_id, content: dispatchTool(root,name,args) }` 追加进 messages。text 事件实时 `onChunk` + 累积；但**只在最终轮**（无 tool_call 的那轮）累积进 `ai_response`——注意：中间轮的 text 也可能出现，需求上只把最终答复写正文，故用一个 `finalText` 只在"本轮无 tool_call"时累积并 onChunk；有 tool_call 的轮，其 text（模型的思考前言）可选择 onChunk 展示但不进 finalText（实现取：只 onChunk 最终轮文本，保持正文=最终答复）。`deps.ts` 装配加 `settings`。更新所有 `createAnswerService({...})` 调用点。

Run: `export PATH=...v22.../bin:$PATH && pnpm --filter @vibe/server test && ... tsc`

- [ ] **Step 5: 提交** `feat: answer-service 工具循环（有根目录则按需读文件作答）`

---

## Task 5: web 最小设置面板 + client settings 方法

**Files:**
- Create: `packages/web/src/components/SettingsPanel.tsx` (+ `.test.tsx`)
- Modify: `packages/web/src/api/client.ts`（`getSettings`/`updateSettings`）
- Modify: `packages/web/src/components/Workbench.tsx`（header 加「设置」按钮开合）
- Modify: `packages/web/src/api/types.ts` 或就地定义 Settings 类型（若需要）

**Interfaces:**
- `api.getSettings(): Promise<{ provider: string; model: string; baseUrl: string|null; hasApiKey: boolean; projectRoot: string|null }>`
- `api.updateSettings(patch: { provider?; model?; baseUrl?; apiKey?; projectRoot? }): Promise<同上>`
- `<SettingsPanel />`：加载 getSettings，展示「项目根目录」输入 + provider 字段；保存调 updateSettings；成功 toast/提示。

- [ ] **Step 1: 写失败测试**

`client.test.ts`：`getSettings` GET `/api/settings`；`updateSettings({projectRoot:'/x'})` PUT with body。`SettingsPanel.test.tsx`：mock api，渲染→改「项目根目录」→保存→断言 updateSettings 被以 `{projectRoot:'/x'}` 调；加载时回填 projectRoot。

- [ ] **Step 2–4: 失败 → 实现 → 通过**

client 加两方法。SettingsPanel 用 `useApi()` + 本地 state。Workbench header（版本历史按钮附近）加 `<button className="quiet-button" onClick={()=>setShowSettings(s=>!s)}>设置</button>` + `{showSettings && <SettingsPanel/>}`。保持现有 Workbench 测试通过（按 role/text 查询，新增按钮不冲突；若某测试按钮计数敏感则更新）。

Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit`

- [ ] **Step 5: 提交** `feat: 最小设置面板（项目根目录 + Provider 配置）`

---

## Task 6: e2e 验收

**Files:** 无（midscene + 真实目录；dev :5173/:4000）

- [ ] **Step 1:** dev 在跑（`curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`=200）。确认服务端以 Node 22 跑（better-sqlite3）。
- [ ] **Step 2:** 打开「设置」面板，填项目根目录为本仓库路径（`/Users/bytedance/luobata/vibe-docing`），保存。
- [ ] **Step 3:** 新建/选一个节点，提问"这个项目用什么测试框架、怎么跑测试？"。观察：回答正确提到 vitest / pnpm test（说明模型 read_file 了 package.json）。截图。
- [ ] **Step 4:** 填一个不存在的目录→保存→提问，确认退回纯对话或给出目录错误提示（不崩）。清空根目录→提问，纯对话正常。截图记录。

---

## 自查结论

- Spec 覆盖：安全/工具→T1；配置→T2；tool-calling→T3；循环→T4；UI→T5；验收→T6。
- 类型一致：`ChatMessage` 扩展、`ToolEvent`、`streamWithTools`、`dispatchTool`、`getProjectRoot`/`resolveProjectRoot`、settings client 类型在定义与调用处一致。
- 注意点：T4 改 `createAnswerService` 签名——所有调用点（deps.ts + 测试）必须同步；执行时先 grep `createAnswerService(` 全量改。
- 安全基建（safeResolve/isExcluded）是 T1 一次性交付，后续工具复用。
