# 编辑问题后重新提问 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让用户编辑已发出的问题（主问题 + 对话轮次问题）后重新生成答案，旧答案进版本历史。

**Architecture:** 纯前端（`packages/web`）。新增可复用 `QuestionEditor`（贴图 + Enter 提交）；MainDoc 顶部渲染可编辑主问题、把轮次问题的 `<p>` 换成 QuestionEditor；编辑保存 = `api.editNode(userInput)` + 重新 `streamAnswer`（后端已自动快照旧答案）。

**Tech Stack:** React+TS+Vite；vitest(jsdom)。web-only，无需 Node 22 / better-sqlite3。

## Global Constraints

- `pnpm --filter @vibe/web test` 全绿（当前基线 113）；`pnpm --filter @vibe/web exec tsc --noEmit` exit 0。
- 提交中文 `feat:` 前缀 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 不新增运行时依赖。复用 `usePastedImages`（`../flow/use-pasted-images`）+ `ImageThumbs`（`./ImageThumbs`）。
- 图片本地预览、不进 onResubmit/不喂模型（与 ChatBox/AnnotationBubble 一致）。
- 不改后端、不改 Workbench `<h2>`、不改版本历史机制。
- 现有 MainDoc/Workbench 测试保持通过。

---

## Task 1: QuestionEditor 组件

**Files:**
- Create: `packages/web/src/components/QuestionEditor.tsx`
- Create: `packages/web/src/components/QuestionEditor.test.tsx`

**Interfaces (Produces):**
- `<QuestionEditor question={string} disabled?={boolean} onResubmit={(next: string) => void} />`
  - 默认态：显示 `question` 文本 + 「编辑」按钮（`aria-label="编辑问题"`）。
  - 编辑态：`<textarea aria-label="edit-question">` 预填 question + `usePastedImages`/`ImageThumbs` + 「保存并重新生成」+「取消」按钮。
  - Enter（非 Shift、非 isComposing）→ 提交非空 trimmed → `onResubmit` + 退出编辑 + clear 图片；「保存并重新生成」按钮同逻辑。取消 → 还原+退出+clear。`disabled` 时「编辑」按钮禁用（不进入编辑态）。

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionEditor } from './QuestionEditor'

describe('QuestionEditor', () => {
  it('shows question text and an edit button by default', () => {
    render(<QuestionEditor question="原问题" onResubmit={() => {}} />)
    expect(screen.getByText('原问题')).toBeInTheDocument()
    expect(screen.getByLabelText('编辑问题')).toBeInTheDocument()
    expect(screen.queryByLabelText('edit-question')).toBeNull()
  })
  it('enters edit mode prefilled and resubmits trimmed on Enter', () => {
    const onResubmit = vi.fn()
    render(<QuestionEditor question="原问题" onResubmit={onResubmit} />)
    fireEvent.click(screen.getByLabelText('编辑问题'))
    const ta = screen.getByLabelText('edit-question')
    expect(ta).toHaveValue('原问题')
    fireEvent.change(ta, { target: { value: '  改后的问题  ' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(onResubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onResubmit).toHaveBeenCalledWith('改后的问题')
  })
  it('cancel exits edit mode without resubmitting', () => {
    const onResubmit = vi.fn()
    render(<QuestionEditor question="原问题" onResubmit={onResubmit} />)
    fireEvent.click(screen.getByLabelText('编辑问题'))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onResubmit).not.toHaveBeenCalled()
    expect(screen.getByText('原问题')).toBeInTheDocument()
  })
  it('does not enter edit mode when disabled', () => {
    render(<QuestionEditor disabled question="原问题" onResubmit={() => {}} />)
    fireEvent.click(screen.getByLabelText('编辑问题'))
    expect(screen.queryByLabelText('edit-question')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/QuestionEditor.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```tsx
import { useState, type KeyboardEvent } from 'react'
import { usePastedImages } from '../flow/use-pasted-images'
import { ImageThumbs } from './ImageThumbs'

export function QuestionEditor({ question, disabled, onResubmit }: {
  question: string; disabled?: boolean; onResubmit(next: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(question)
  const imgs = usePastedImages()

  function submit(): void {
    const next = value.trim()
    if (!next) return
    onResubmit(next)
    imgs.clear()
    setEditing(false)
  }
  function cancel(): void { setValue(question); imgs.clear(); setEditing(false) }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
    e.preventDefault(); submit()
  }

  if (!editing) {
    return (
      <div className="question-view">
        <span className="question-text">{question}</span>
        <button aria-label="编辑问题" className="quiet-button" disabled={disabled}
          onClick={() => { if (!disabled) { setValue(question); setEditing(true) } }} type="button">编辑</button>
      </div>
    )
  }
  return (
    <div className="question-editor">
      <textarea aria-label="edit-question" autoFocus onChange={(e) => setValue(e.target.value)}
        onDrop={imgs.handleDrop} onKeyDown={onKeyDown} onPaste={imgs.handlePaste} value={value} />
      <ImageThumbs images={imgs.images} onRemove={imgs.removeImage} />
      <div className="question-editor-actions">
        <button className="primary-button" disabled={!value.trim()} onClick={submit} type="button">保存并重新生成</button>
        <button className="quiet-button" onClick={cancel} type="button">取消</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过 + tsc + 提交**

```bash
pnpm --filter @vibe/web test -- --run src/components/QuestionEditor.test.tsx && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/components/QuestionEditor.tsx packages/web/src/components/QuestionEditor.test.tsx
git commit -m "feat: QuestionEditor 组件（就地编辑问题+贴图+Enter 提交）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: MainDoc 主问题编辑接入

**Files:**
- Modify: `packages/web/src/components/MainDoc.tsx`
- Test: `packages/web/src/components/MainDoc.test.tsx`

**Interfaces:**
- Consumes: `QuestionEditor`（Task 1）、现有 `api.editNode`/`api.streamAnswer`/`upsertNode`/`plainTextToProseMirror`。
- Produces: 主问题在正文顶部可编辑；保存 → `editMainQuestion(next)`。

- [ ] **Step 1: 写失败测试**

在 MainDoc.test.tsx 加（沿用其 harness：`loadTree` + `ApiProvider`，node 带 `user_input`）：加载后正文顶部出现「编辑问题」按钮；点编辑→改文本→保存→断言 `api.editNode` 以 `(node.id, { userInput: 新值 })` 调用，且 `api.streamAnswer` 被调用重新生成。（用 vi.fn mock；streamAnswer mock 触发 onDone。）

```tsx
it('edits the main question and regenerates', async () => {
  const editNode = vi.fn(async (_id, body) => ({ node: { ...node('root', null), user_input: body.userInput } }))
  const streamAnswer = vi.fn(async (_id, _q, h) => { h.onChunk('新答案'); h.onDone({ ...node('root', null), status: 'complete' }) })
  useWorkbench.getState().loadTree({ nodes: [node('root', null)], rootNodeId: 'root', treeId: 't' })
  render(<ApiProvider api={{ getNode: async () => ({ node: node('root', null), annotations: [], segments: [] }), editNode, streamAnswer } as never}><MainDoc /></ApiProvider>)
  await waitFor(() => screen.getByLabelText('编辑问题'))
  fireEvent.click(screen.getByLabelText('编辑问题'))
  fireEvent.change(screen.getByLabelText('edit-question'), { target: { value: '改后的主问题' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并重新生成' }))
  await waitFor(() => expect(editNode).toHaveBeenCalledWith('root', { userInput: '改后的主问题' }))
  expect(streamAnswer).toHaveBeenCalled()
})
```
(node() helper already exists in the file; it sets user_input:'Q'. Adjust as needed.)

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/MainDoc.test.tsx`
Expected: FAIL（无编辑问题按钮）

- [ ] **Step 3: 实现**

在 MainDoc 加 `editMainQuestion`（放在 `retryCurrent` 附近）：

```tsx
async function editMainQuestion(next: string): Promise<void> {
  if (busy) return
  setBusy(true); setError(null); setPhase('thinking'); stopRef.current = false
  try {
    const prepared = await api.editNode(node.id, { userInput: next })
    let text = ''
    upsertNode({ ...prepared.node, ai_response: plainTextToProseMirror(''), status: 'streaming', user_input: next })
    await api.streamAnswer(node.id, next, {
      onChunk(chunk) { if (stopRef.current) return; setPhase('replying'); text += chunk; upsertNode({ ...prepared.node, ai_response: plainTextToProseMirror(text), status: 'streaming', user_input: next }) },
      onDone(doneNode) { if (stopRef.current) return; upsertNode({ ...doneNode, status: doneNode.status ?? 'complete' }); setPhase('idle') },
      onError(message) { if (stopRef.current) return; upsertNode({ ...prepared.node, status: 'error', user_input: next }); setError(humanize(message)); setPhase('idle') },
    })
  } catch (cause) {
    if (!stopRef.current) setError(cause instanceof Error ? humanize(cause.message) : '重新生成失败，请重试。')
    setPhase('idle')
  } finally { setBusy(false) }
}
```

在 return 里，第一个 `<DocView .../>` 之上插入（仅当有问题时）：
```tsx
{node.user_input && (
  <QuestionEditor question={node.user_input} disabled={busy} onResubmit={(next) => { void editMainQuestion(next) }} />
)}
```
import `QuestionEditor`。

- [ ] **Step 4: 运行通过 + 全量 + tsc + 提交**

```bash
pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/components/MainDoc.tsx packages/web/src/components/MainDoc.test.tsx
git commit -m "feat: 主问题可编辑并重新生成（旧答案进版本历史）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: MainDoc 轮次问题编辑接入

**Files:**
- Modify: `packages/web/src/components/MainDoc.tsx`
- Test: `packages/web/src/components/MainDoc.test.tsx`

**Interfaces:**
- Produces: transcript 里每条问题可编辑；保存 → `editTurnQuestion(turn, next)`；新增 `patchTurn(id, patch)` 按 id 更新（不再只改末轮）。

- [ ] **Step 1: 写失败测试**

构造一个 transcript（最简：先 mock ask 造一轮，或直接测 editTurnQuestion 的效果）。断言：编辑某 turn 的问题→保存→`api.editNode(turnId, {userInput:新值})` 被调 + 该 turn 的答案重新生成，且其它 turn 不受影响（若只有一轮，至少断言 editNode 用了该 turn id 且 turn.question 更新）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/MainDoc.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

1. 新增按 id 更新 turn 的 helper（替换/补充 `patchLastTurn` 的用法不必动，只加）：
```tsx
function patchTurn(id: string, patch: Partial<NodeRow>): void {
  setTranscript((turns) => turns.map((t) => t.id === id ? { ...t, answer: { ...t.answer, ...patch } } : t))
}
```
2. `runTurn` 目前用 `patchLastTurn`——为支持编辑非末轮，改 `runTurn(answerId, question)` 内部改用 `patchTurn(answerId, ...)`（按 answerId 定位，语义等价于末轮时的行为，且对非末轮正确）。确认 `retryLastTurn` 仍可用（它调用 `runTurn(lastTurnNodeId, ...)`，改后依然对）。
3. `editTurnQuestion`：
```tsx
async function editTurnQuestion(turn: Turn, next: string): Promise<void> {
  if (busy) return
  setBusy(true); setError(null); setPhase('thinking'); stopRef.current = false
  try {
    await api.editNode(turn.id, { userInput: next })
    setTranscript((turns) => turns.map((t) => t.id === turn.id
      ? { ...t, question: next, answer: { ...t.answer, ai_response: plainTextToProseMirror(''), status: 'streaming', user_input: next } } : t))
    setLastQuestion(next)
    await runTurn(turn.id, next)
  } catch (cause) {
    if (!stopRef.current) setError(cause instanceof Error ? humanize(cause.message) : '重新生成失败，请重试。')
    setPhase('idle')
  } finally { setBusy(false) }
}
```
4. 把 `<p className="turn-question">{turn.question}</p>` 换成：
```tsx
<QuestionEditor question={turn.question} disabled={busy} onResubmit={(next) => { void editTurnQuestion(turn, next) }} />
```
（保留 `turn-question` 类/testid 若测试依赖——检查 MainDoc.test.tsx 是否 query `turn-question`；若是，让 QuestionEditor 默认态外层带该 class 或更新测试。）

- [ ] **Step 4: 全量 + tsc + 提交**

```bash
pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/components/MainDoc.tsx packages/web/src/components/MainDoc.test.tsx
git commit -m "feat: 对话轮次问题可就地编辑并重新生成该轮

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: e2e 验收

**Files:** 无（midscene；dev :5173/:4000，服务端 Node 22）

- [ ] **Step 1:** dev 在跑（curl 5173=200）。选一个已有问答的节点。
- [ ] **Step 2 (主问题):** 点正文顶部问题的「编辑」→ 改文本 → 保存并重新生成 → 截图确认问题更新 + 生成了新答案。
- [ ] **Step 3 (版本历史):** 打开「版本历史」，确认有旧答案快照。
- [ ] **Step 4 (轮次问题):** 若有追问轮次，编辑一条追问 → 重新生成该轮 → 截图确认只该轮变化。记录截图。

---

## 自查

- Spec 覆盖：QuestionEditor→T1；主问题→T2；轮次问题+patchTurn→T3；e2e→T4。
- 复用：editNode（自动快照）、streamAnswer、usePastedImages/ImageThumbs。
- 注意：T3 把 runTurn 从 patchLastTurn 改为 patchTurn(answerId)——执行时确认 retryLastTurn 仍正确（用 lastTurnNodeId 调 runTurn）。若 MainDoc.test 依赖 `turn-question` testid，同步处理。
