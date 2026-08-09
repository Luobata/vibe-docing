# 编辑问题后重新提问 设计

- 日期：2026-08-09
- 状态：待评审
- 范围：`packages/web`（纯前端；后端 editNode/streamAnswer/版本快照均已具备）

## 背景与目标

用户想像 Codex/ChatGPT 那样：针对某个问题**编辑后重新提问**（输错了、输一半误发了）。当前问题一旦发出无法就地修改重发。目标：给已显示的问题加「编辑」入口，改完重新生成答案，旧答案进版本历史。用户已确认：覆盖**主问题 + 对话轮次问题**；编辑框支持粘贴图片；重新生成**覆盖**旧答案且**版本历史可找回**。

## 现状调研结论（事实）

- **后端已全部支持**（无需改）：`PATCH /api/nodes/:id` (`editNode`) 更新 `user_input`/`ai_response` **并 `versions.snapshot({changeKind:'edit'})`**（`node-edit.ts`）；`streamAnswer` 重新生成；`generate` 完成时也 `snapshot({changeKind:'regenerate'})`。→ 编辑重问 = `editNode(userInput)` + 重新流式生成，旧答案自动进版本历史。
- **主问题只在 Workbench `<h2>` 显示**（`nodeLabel(node.user_input)` 取首行），Workbench 无 api/streaming 机制。MainDoc 才持有全部编辑+流式逻辑：`answerInPlace`（`editNode`+重流）、`retryCurrent`（重流当前节点）、`runTurn`（重流某 turn）。
- **轮次问题**在 MainDoc 以 `<p className="turn-question">{turn.question}</p>` 显示（本地 `transcript` state）。
- 已有可复用件：`usePastedImages` + `ImageThumbs`（贴图预览）；`plainTextToProseMirror`；`upsertNode`。

## 决策（已确认）

- 覆盖主问题 + 轮次问题。
- 编辑框支持粘贴图片（本地预览，不喂模型，与其它输入框一致）。
- 重新生成覆盖旧答案；旧答案已快照，版本历史可找回（复用现有机制，不新增）。

## 分项设计

### 1. QuestionEditor 组件（可复用）
新组件 `packages/web/src/components/QuestionEditor.tsx`：
- Props：`{ question: string; disabled?: boolean; onResubmit(next: string): void }`。
- 默认态：显示问题文本 + 一个「编辑」按钮（`aria-label="编辑问题"`，铅笔/文字）。
- 编辑态（本地 `editing` state）：`<textarea>` 预填 `question` + `usePastedImages` + `<ImageThumbs>`；按钮「保存并重新生成」+「取消」。
- 键盘：Enter 提交（非 Shift、非 isComposing）、Shift+Enter 换行（与 ChatBox 一致）。
- 提交：`onResubmit(trimmed)`，然后退出编辑态 + 清图；空文本禁用提交；`disabled` 时不可进入/提交（生成中）。
- 取消：还原、退出编辑态、清图。

### 2. 主问题接入（MainDoc）
- 在 MainDoc 顶部、第一个 `DocView` 之上渲染 `<QuestionEditor question={node.user_input ?? ''} disabled={busy} onResubmit={editMainQuestion} />`（仅当 `node.user_input` 非空时显示——空根节点还没有问题，不渲染）。
- `editMainQuestion(next)`：类似 `answerInPlace` 但用于已有节点——`await api.editNode(node.id, { userInput: next })` → `upsertNode` 更新问题并清空答案为 streaming → `streamAnswer(node.id, next, {...})` 重新生成，onDone `upsertNode`。设 busy/phase，与现有一致。旧答案由后端 editNode 快照。
- Workbench `<h2>` 不动（它只显示首行短标题，编辑后 `nodeLabel` 会随 store 更新自动刷新）。

### 3. 轮次问题接入（MainDoc）
- `turn-question` 的 `<p>` 换成 `<QuestionEditor question={turn.question} disabled={busy} onResubmit={(next)=>editTurnQuestion(turn, next)} />`。
- `editTurnQuestion(turn, next)`：`await api.editNode(turn.id, { userInput: next })` → 更新该 turn 的 `question` + `answer.user_input`，答案置 streaming（`setTranscript` 局部更新那条）→ `runTurn(turn.id, next)` 重新生成该轮。注意 `runTurn` 现在用 `patchLastTurn`（只改最后一条）；重构为可指定 turn id 的更新（或新增 `patchTurn(id, patch)`），避免编辑非末轮时改错条目。

### 4. 交互与边界
- 生成中（`busy`）禁用所有 QuestionEditor 的编辑/提交。
- 编辑非末轮问题也允许（各 turn 独立按 id 定位更新）。
- 覆盖式：重新生成直接替换该问题下方答案；不额外弹确认（版本历史兜底）。

## 测试策略

- `QuestionEditor` 单测：默认显示文本+编辑按钮；点编辑进入 textarea 预填；Enter 调 `onResubmit(trimmed)` 并退出编辑态；Shift+Enter 不提交；取消还原；`disabled` 时不可提交；贴图出现缩略图。
- MainDoc 单测：
  - 主问题编辑：加载一个有 `user_input` 的节点，进入编辑改文本→保存→断言 `api.editNode(node.id,{userInput:新值})` 被调 + `streamAnswer` 重新生成 + 问题更新。
  - 轮次问题编辑：构造一个有 transcript 的场景（或通过 ask 造一轮），编辑某 turn→断言 `editNode(turnId,...)` + 该 turn 答案重生成，且**只**改动那条 turn。
- 现有 MainDoc/Workbench 测试保持通过。
- e2e：编辑主问题（模拟输错→改对）重新生成；编辑一条追问重新生成；确认版本历史里有旧答案。

## 分期与依赖

1. **P1** QuestionEditor 组件（+单测）。
2. **P2** MainDoc 主问题接入（editMainQuestion）+ 单测。
3. **P3** MainDoc 轮次问题接入（editTurnQuestion + patchTurn 按 id）+ 单测。
4. **P4** e2e 验收。
（P2/P3 都依赖 P1。）

## 非目标（YAGNI）

- 改 Workbench `<h2>` 标题的编辑（它是派生短标题，随节点更新自动刷新）。
- 图片真正喂模型。
- 编辑分叉成新分支（Codex 的 branch 版本树）——本期是覆盖 + 版本历史，不做分支化。
- 版本历史机制改动（直接复用现有 editNode/regenerate 快照）。
