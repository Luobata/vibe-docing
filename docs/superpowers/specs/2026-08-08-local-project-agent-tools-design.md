# 让本地项目可读：Agent 只读工具调用 设计

- 日期：2026-08-08
- 状态：待评审
- 范围：`packages/server`（工具 + provider tool-calling + answer 循环 + 配置）、`packages/web`（最小设置面板）

## 背景与目标

当前模型是远程 OpenAI 兼容 `/chat/completions`，只发纯文本 `ChatMessage[]`，无工具能力；本地服务端（Fastify + better-sqlite3）能读文件系统但目前只读 `schema.sql`。目标：**配一个本地项目根目录，模型在回答时按需 `list_dir`/`read_file`/`grep`/`find_files`/`read_lines` 浏览该目录，据此对话**——像"在目录里开会话"。用户已确认：路线 C（Agent 工具调用）、5 个只读工具、根目录在设置页填、模型端点支持 OpenAI 式 tool-calling、本期不做写/执行类工具。

## 现状调研结论（事实）

- `answer-service.ts:42`：`assembleContext(deps, nodeId, userInput)` → `provider.stream(messages)` 单轮流式，累积写 `ai_response`。`createAnswerService({ nodes, segments, versions })`（**不含 settings/context**）。
- `provider/types.ts`：`Provider { complete, stream }`，纯文本，无工具。`codex-provider.ts` 走 `/chat/completions` `stream:true`，逐 delta yield。
- `registry.ts`：`resolveProvider(deps, override)` 按 `settings.getProviderConfig()` 构建。
- `settings-repo.ts`：kv 表，`get/set/getProviderConfig`；路由 `/api/settings` GET/PUT 存在，但 **web 端零调用、无设置 UI、client 无 settings 方法**。
- 唯一 fs 用法：`connection.ts` 读 schema。无路径穿越防护基建。

## 决策（已确认）

- 5 个**只读**工具：`list_dir`、`read_file`、`grep`、`find_files`、`read_lines`。不做写/执行类（另立项）。
- 根目录：设置页填绝对路径，存 settings 键 `project.root`。
- tool-calling：用官方 OpenAI `tools`/`tool_calls` 协议。
- 无根目录配置时：工具不可用，退回现有纯对话（不报错）。

## 安全（硬要求，所有工具共享一次性基建）

- **根目录 allowlist + 路径穿越防护**：所有工具入参路径 `path.resolve(root, p)` 后必须 `startsWith(root + sep)`（或等于 root）；否则拒绝。软链接解析后再校验（`fs.realpathSync`）。
- **排除**：`.git`、`node_modules`、`.env`/`.env.*`、以 `.` 开头的隐藏文件/目录，默认跳过（`list_dir`/`find_files`/`grep` 不返回，`read_file` 拒绝）。
- **单文件大小上限**（如 256KB）：超限 `read_file` 返回错误提示而非内容。
- **最大工具轮数上限**（如 12 轮）：循环内超过即停止工具、要求模型基于已有信息作答（防死循环/token 失控）。
- 根目录必须存在且是目录（启动时/使用时校验）。

## 分项设计

### 1. 根目录配置（settings + 校验）
- settings 新键 `project.root`（字符串绝对路径）。
- `settings-repo` 加 `getProjectRoot(): string | null`（读键；空串视为 null）。
- 一个纯校验函数 `resolveProjectRoot(raw): { root: string } | { error: string }`：trim、绝对路径、`existsSync` 且 `statSync().isDirectory()`。

### 2. 文件工具（纯函数 + 安全校验，最先做、最好测）
新文件 `packages/server/src/tools/fs-tools.ts`，导出：
- `safeResolve(root, p): string`（穿越防护，越界 throw）。
- `isExcluded(relPath): boolean`（.git/node_modules/dotfiles/.env）。
- 五个执行器，签名统一 `(root, args) => string`（返回给模型的文本；错误也返回文本而非 throw，除穿越/越权用明确错误串）：
  - `listDir(root, { path })` → 目录项列表（标注 dir/file，排除项不列）。
  - `readFile(root, { path })` → 文件内容（超大小上限→错误串；排除→拒绝）。
  - `grep(root, { pattern, path? })` → 命中 `相对路径:行号:行` 列表（上限 N 条）。
  - `findFiles(root, { glob })` → 匹配的相对路径列表（排除项不含）。
  - `readLines(root, { path, start, end })` → 指定行区间。
- 一个 `TOOL_SCHEMAS`（OpenAI tools JSON schema 数组）+ `dispatchTool(root, name, argsJson): string`。

### 3. provider tool-calling
- `Provider` 加可选方法 `streamWithTools?(messages, tools, options): AsyncIterable<ToolEvent>`，其中 `ToolEvent = { type:'text'; text } | { type:'tool_call'; id; name; arguments }`。保留现有 `stream`（无工具场景/无根目录时用）。
- `codex-provider` 实现：请求体带 `tools` + `tool_choice:'auto'`；解析流里的 `delta.content`（text）与 `delta.tool_calls`（累积 id/name/arguments 分片，完成后 emit `tool_call`）。一轮结束（finish_reason）后交由上层决定是否继续。
- 类型 `ChatMessage` 扩展支持 `role:'tool'`（带 `tool_call_id`）与 assistant 的 `tool_calls`，以回灌工具结果。

### 4. answer-service 工具循环
- `createAnswerService` 增加依赖 `settings`（拿 `project.root`）——注意这会改构造签名，`deps.ts` 的装配与 `answer-service.test.ts` 等所有 `createAnswerService({ nodes, segments, versions })` 调用点都要补 `settings`。`generate` 内：
  1. 组装基础 messages（`assembleContext`）。若有有效 root：追加一条 system 提示"你可调用工具浏览项目根目录 <root>"，并走工具循环；否则走现有单轮 `stream`（零行为变化）。
  2. **工具循环**（≤ maxRounds）：调 `provider.streamWithTools(messages, TOOL_SCHEMAS)`，流式 text 直接 `onChunk` + 累积；若本轮产生 tool_call：把 assistant(tool_calls) + 每个 `dispatchTool` 结果作为 `role:'tool'` 追加进 messages，进入下一轮。若本轮无 tool_call（模型给了最终答复）→ 结束。
  3. 达到 maxRounds 仍要工具 → 追加一条 system"工具轮数已达上限，请基于已有信息作答"，再单轮 `stream` 收尾。
  4. 只有最终文本写入 `ai_response`（工具往返不写正文，与现有 merge 段落不混）。
- `abort` 信号透传到每轮请求。

### 5. web 最小设置面板
- 新组件 `SettingsPanel.tsx`：一个「项目根目录」输入 + 保存；顺带展示/编辑已有 provider 配置（model/baseUrl/apiKey/provider），因为设置页本就该有。入口：主文档 header 加一个「设置」按钮（`quiet-button`，类似「版本历史」）开合。
- client 加 `getSettings()` / `updateSettings(patch)`（对接 GET/PUT `/api/settings`）；`/api/settings` PUT 的 `allowedKeys` 扩入 `projectRoot`（→ 存 `project.root`），GET 的 `settingsView` 增 `projectRoot` 字段（apiKey 仍只回 `hasApiKey` 不回明文）。

## 测试策略

- **fs-tools**（重点）：`safeResolve` 拒 `../`/绝对路径逃逸/软链逃逸；`isExcluded` 命中 .git/node_modules/.env/dotfiles；五工具各自 happy path + 边界（超大文件、越界、不存在、行区间越界）。用临时目录 fixture。
- **settings**：`getProjectRoot`、`resolveProjectRoot`（不存在/非目录/相对路径→error）；PUT 存 `project.root`、GET 回 `projectRoot`、apiKey 不泄漏。
- **provider**：`streamWithTools` 解析 text + 累积 tool_calls 分片（mock SSE）。
- **answer-service 循环**：mock provider 先发 tool_call 再发最终文本 → 断言 dispatchTool 被调、messages 追加 tool 结果、只有最终文本写 ai_response、maxRounds 收尾、无 root 时退回单轮。
- **web**：SettingsPanel 保存调用 updateSettings；client 方法 URL/method。
- e2e：设置页填一个真实目录（如本仓库），提问"这个项目用什么测试框架/怎么构建"，观察模型 read_file(package.json) 后正确作答；填非法目录→报错提示；不填→纯对话正常。

## 分期与依赖

1. **P1** fs-tools（safeResolve/isExcluded/5 执行器/schemas/dispatch）+ 单测。纯函数，无外部依赖，最先。
2. **P2** settings：`project.root` 键 + `getProjectRoot`/`resolveProjectRoot` + 路由扩 projectRoot。
3. **P3** provider tool-calling（ChatMessage 扩展 + streamWithTools + codex 实现）。
4. **P4** answer-service 工具循环（依赖 P1/P2/P3；接入 settings 依赖）。
5. **P5** web 最小设置面板 + client settings 方法（依赖 P2）。
6. **P6** e2e 验收。

## 非目标（YAGNI）

- 写/执行类工具（write_file/run_command 等）——另立项，含独立安全设计。
- 向量检索/索引（本期靠模型按需读 + grep）。
- 多根目录 / 每树独立根目录（本期全局单根）。
- 图片/二进制文件读取（只读文本；二进制 read_file 返回"非文本"提示）。
- 把工具往返过程持久化展示（本期只把最终答复写正文）。
