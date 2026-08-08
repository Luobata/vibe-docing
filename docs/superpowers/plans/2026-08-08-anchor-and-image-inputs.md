# 补充功能实现计划：图片输入对齐 + 正文→右栏锚定

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让右键气泡两输入与右栏笔记输入具备底部同款图片粘贴/预览/快捷提交能力；点击正文高亮标记时右栏按「优先分支」规则锚定对应分支/笔记。

**Architecture:** 纯前端（`packages/web`）。抽取 `usePastedImages` hook + `ImageThumbs` 复用图片逻辑；右栏 active Tab 与笔记锚定态提到 `workbench-store`；正文点击经确定性 `pickAnchorTarget` 纯函数路由到右栏。

**Tech Stack:** React 18 + TS + Vite；vitest(jsdom)；hand-rolled `useSyncExternalStore` store。

## Global Constraints

- `pnpm --filter @vibe/web test` 全绿（当前 96）；`pnpm --filter @vibe/web exec tsc --noEmit` exit 0。服务端测试用 Node 22（`~/.nvm/versions/node/v22.21.1/bin` 前置 PATH）——本计划纯前端 jsdom，不需 better-sqlite3。
- 提交信息中文 `feat:`/`refactor:` 前缀 + `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。
- 不新增运行时依赖、不加网络字体。
- 图片保持「本地预览、提交清空、模型不读图」——不改变该行为，不夸大能力。沿用 `chat-images`/`chat-image-thumb`/`image-degrade-hint` 类名与 testid。
- 笔记 = annotation `child_node_id === null`；派生分支 = `child_node_id` 有值。
- store 现有：`activeSubdocId`/`setActiveSubdoc`、`openSubdocTab(nodeId)`、`focusedAnnotationId`/`setFocusedAnnotation`、`notesForMain`(全量 annotations)。新字段必须加进 `initialData()`。
- 类型：`AnnotationRow { id, node_id, kind, anchor_from:number|null, anchor_to:number|null, quoted_text:string|null, note:string|null, child_node_id:string|null, created_at:string }`。

---

## Task 1: 抽取 usePastedImages hook + ImageThumbs，ChatBox 接入（行为不变）

**Files:**
- Create: `packages/web/src/flow/use-pasted-images.ts`
- Create: `packages/web/src/flow/use-pasted-images.test.ts`
- Create: `packages/web/src/components/ImageThumbs.tsx`
- Modify: `packages/web/src/components/ChatBox.tsx`
- Test: 现有 `packages/web/src/components/ChatBox.test.tsx` 必须保持通过

**Interfaces:**
- Produces: `usePastedImages()` → `{ images: PastedImage[], addFiles(files: FileList|File[]): void, removeImage(id: string): void, clear(): void, handlePaste(e): void, handleDrop(e): void }`，`PastedImage = { id: string; name: string; url: string }`。卸载时回收所有 URL。
- Produces: `<ImageThumbs images={PastedImage[]} onRemove={(id)=>void} />` 渲染 `.chat-images`>`.chat-image-thumb`（含 `data-testid="chat-image-thumb"`、`img`、移除按钮 aria-label="移除图片"）。

- [ ] **Step 1: 写 hook 失败测试**

```ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePastedImages } from './use-pasted-images'

function imgFile(name = 'a.png') { return new File([new Uint8Array([1])], name, { type: 'image/png' }) }
function txtFile() { return new File(['x'], 't.txt', { type: 'text/plain' }) }

describe('usePastedImages', () => {
  beforeEach(() => { globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn() })
  it('adds only image files', () => {
    const { result } = renderHook(() => usePastedImages())
    act(() => result.current.addFiles([imgFile(), txtFile()]))
    expect(result.current.images).toHaveLength(1)
  })
  it('removes and clears, revoking urls', () => {
    const { result } = renderHook(() => usePastedImages())
    act(() => result.current.addFiles([imgFile(), imgFile('b.png')]))
    const id = result.current.images[0].id
    act(() => result.current.removeImage(id))
    expect(result.current.images).toHaveLength(1)
    act(() => result.current.clear())
    expect(result.current.images).toHaveLength(0)
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/flow/use-pasted-images.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hook**

把 `ChatBox.tsx` 现有的 `PastedImage`、`seq`、`addImageFiles`、`removeImage`、`handlePaste`、`handleDrop`、卸载回收 effect 平移进 `use-pasted-images.ts`，导出 `usePastedImages`。`clear()` 回收所有 url 并置空。`addFiles` 过滤 `file.type.startsWith('image/')`。

```ts
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'

export interface PastedImage { id: string; name: string; url: string }

export function usePastedImages() {
  const [images, setImages] = useState<PastedImage[]>([])
  const seq = useRef(0)
  useEffect(() => () => { for (const i of images) URL.revokeObjectURL(i.url) }, [images])
  function addFiles(files: FileList | File[]): void {
    const picked: PastedImage[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      seq.current += 1
      picked.push({ id: `img-${seq.current}`, name: file.name, url: URL.createObjectURL(file) })
    }
    if (picked.length) setImages((c) => [...c, ...picked])
  }
  function removeImage(id: string): void {
    setImages((c) => { const t = c.find((i) => i.id === id); if (t) URL.revokeObjectURL(t.url); return c.filter((i) => i.id !== id) })
  }
  function clear(): void { setImages((c) => { for (const i of c) URL.revokeObjectURL(i.url); return [] }) }
  function handlePaste(e: ClipboardEvent): void { const f = e.clipboardData?.files; if (f && f.length) addFiles(f) }
  function handleDrop(e: DragEvent): void { const f = e.dataTransfer?.files; if (f && f.length) { e.preventDefault(); addFiles(f) } }
  return { images, addFiles, removeImage, clear, handlePaste, handleDrop }
}
```

- [ ] **Step 4: 实现 ImageThumbs**

```tsx
import type { PastedImage } from '../flow/use-pasted-images'

export function ImageThumbs({ images, onRemove }: { images: PastedImage[]; onRemove(id: string): void }) {
  if (images.length === 0) return null
  return (
    <div className="chat-images">
      {images.map((image) => (
        <span className="chat-image-thumb" data-testid="chat-image-thumb" key={image.id}>
          <img alt={image.name} src={image.url} />
          <button aria-label="移除图片" onClick={() => onRemove(image.id)} type="button">×</button>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: ChatBox 改用 hook + ImageThumbs**

`ChatBox.tsx`：删除本地 `PastedImage`/`images`/`seq`/`addImageFiles`/`removeImage`/`handlePaste`/`handleDrop`/回收 effect，改 `const { images, clear, handlePaste, handleDrop } = usePastedImages()`。缩略图区替换为 `<ImageThumbs images={images} onRemove={removeImage} />`（从 hook 取 `removeImage`）。`submit()` 里 `images.length>0` 分支改成 `setShowHint(true); clear()`。textarea 的 `onPaste`/`onDrop` 用 hook 的。保持 `image-degrade-hint`、placeholder、Enter/Shift+Enter 行为不变。

- [ ] **Step 6: 运行 hook 测试 + ChatBox 测试 + 全量 + tsc**

Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit`
Expected: PASS（含现有 ChatBox 全部用例），tsc 0

- [ ] **Step 7: 提交**

```bash
git add packages/web/src/flow/use-pasted-images.ts packages/web/src/flow/use-pasted-images.test.ts packages/web/src/components/ImageThumbs.tsx packages/web/src/components/ChatBox.tsx
git commit -m "refactor: 抽取 usePastedImages/ImageThumbs，ChatBox 复用（行为不变）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 气泡两输入接入图片 + Enter 提交

**Files:**
- Modify: `packages/web/src/components/AnnotationBubble.tsx`
- Test: `packages/web/src/components/AnnotationBubble.test.tsx`

**Interfaces:**
- Consumes: `usePastedImages`（Task 1）、`ImageThumbs`（Task 1）。
- 保持既有 props 签名不变（`initialFocus`, `onCreateNote(note)`, `onDismiss`, `onForkExpand(question)`, `selection`）。图片只做本地预览，不进回调。

- [ ] **Step 1: 写失败测试**

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnnotationBubble } from './AnnotationBubble'

const sel = { from: 0, to: 3, text: '内存' } as never

describe('AnnotationBubble image+keyboard', () => {
  it('submits note on Enter (Shift+Enter does not)', () => {
    const onCreateNote = vi.fn()
    render(<AnnotationBubble onCreateNote={onCreateNote} onDismiss={() => {}} onForkExpand={() => {}} selection={sel} />)
    const note = screen.getByLabelText('note')
    fireEvent.change(note, { target: { value: '待验证' } })
    fireEvent.keyDown(note, { key: 'Enter', shiftKey: true })
    expect(onCreateNote).not.toHaveBeenCalled()
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(onCreateNote).toHaveBeenCalledWith('待验证')
  })
  it('submits fork question on Enter', () => {
    const onForkExpand = vi.fn()
    render(<AnnotationBubble initialFocus="expand" onCreateNote={() => {}} onDismiss={() => {}} onForkExpand={onForkExpand} selection={sel} />)
    const q = screen.getByLabelText('fork-question')
    fireEvent.change(q, { target: { value: '继续追问' } })
    fireEvent.keyDown(q, { key: 'Enter' })
    expect(onForkExpand).toHaveBeenCalledWith('继续追问')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/AnnotationBubble.test.tsx`
Expected: FAIL（Enter 未提交）

- [ ] **Step 3: 实现**

`AnnotationBubble.tsx`：加两份 `const noteImgs = usePastedImages(); const forkImgs = usePastedImages()`。每个 textarea 加 `onPaste`/`onDrop`（对应 imgs 的 handler），其后渲染 `<ImageThumbs images={noteImgs.images} onRemove={noteImgs.removeImage} />`（fork 同理）。加共享 keydown 助手：

```tsx
function submitKey(e: React.KeyboardEvent, run: () => void) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
  e.preventDefault(); run()
}
```
笔记 textarea `onKeyDown={(e) => submitKey(e, () => { if (note.trim()) { onCreateNote(note.trim()); noteImgs.clear() } })}`；就此展开 textarea `onKeyDown={(e) => submitKey(e, () => { if (question.trim()) { onForkExpand(question.trim()); forkImgs.clear() } })}`。按钮点击路径也 clear 对应 imgs。（导入 `import { type KeyboardEvent } ...` 或用 `React.KeyboardEvent`，与仓库风格一致。）

- [ ] **Step 4: 运行确认通过 + 全量 + tsc + 提交**

```bash
pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/components/AnnotationBubble.tsx packages/web/src/components/AnnotationBubble.test.tsx
git commit -m "feat: 气泡笔记/就此展开支持粘贴图片与 Enter 提交

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: store 增加 subdocPanelTab + anchoredNoteId

**Files:**
- Modify: `packages/web/src/state/workbench-store.ts`
- Test: `packages/web/src/state/workbench-store.test.ts`

**Interfaces:**
- Produces: `subdocPanelTab: 'derivations' | 'notes'`（默认 `'derivations'`）+ `setSubdocPanelTab(tab: 'derivations' | 'notes'): void`；`anchoredNoteId: string | null` + `setAnchoredNoteId(id: string | null): void`。均在 `initialData()`。

- [ ] **Step 1: 写失败测试**

```ts
it('tracks subdoc panel tab and anchored note', () => {
  const s = useWorkbench.getState()
  expect(useWorkbench.getState().subdocPanelTab).toBe('derivations')
  s.setSubdocPanelTab('notes')
  expect(useWorkbench.getState().subdocPanelTab).toBe('notes')
  s.setAnchoredNoteId('ann-9')
  expect(useWorkbench.getState().anchoredNoteId).toBe('ann-9')
  s.setAnchoredNoteId(null)
  expect(useWorkbench.getState().anchoredNoteId).toBeNull()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/state/workbench-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`WorkbenchData` 加 `subdocPanelTab: 'derivations' | 'notes'` 与 `anchoredNoteId: string | null`；`initialData()` 加 `subdocPanelTab: 'derivations',` 和 `anchoredNoteId: null,`；`WorkbenchState` 加两个 setter 签名；actions 加：

```ts
setSubdocPanelTab(tab) { patch({ subdocPanelTab: tab }) },
setAnchoredNoteId(id) { patch({ anchoredNoteId: id }) },
```

- [ ] **Step 4: 运行确认通过 + 提交**

```bash
pnpm --filter @vibe/web test -- --run src/state/workbench-store.test.ts
git add packages/web/src/state/workbench-store.ts packages/web/src/state/workbench-store.test.ts
git commit -m "feat: store 增加右栏 Tab 与笔记锚定态

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: SubdocPanelTabs 用 store tab；NotesTab 新建输入 + 锚定高亮

**Files:**
- Modify: `packages/web/src/components/SubdocPanelTabs.tsx`
- Modify: `packages/web/src/components/NotesTab.tsx`
- Modify: `packages/web/src/components/Workbench.tsx`（透传 onCreateNote 到 NotesTab）
- Modify: `packages/web/src/components/MainDoc.tsx`（暴露一个可复用的 createNote，供右栏笔记输入调用）
- Test: `packages/web/src/components/NotesTab.test.tsx`

**Interfaces:**
- Consumes: store `subdocPanelTab`/`setSubdocPanelTab`（Task 3）、`anchoredNoteId`（Task 3）、`usePastedImages`/`ImageThumbs`（Task 1）、`api.createNote`。
- `SubdocPanelTabs` 从 store 读写 tab；给 `NotesTab` 传 `onCreateNote(note: string): void`。
- `NotesTab({ annotations, onJump, onCreateNote })`：顶部「新建笔记」输入（图片+Enter 提交），列表项按 `anchoredNoteId` 高亮+滚动。

- [ ] **Step 1: NotesTab 失败测试**

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import type { AnnotationRow } from '@vibe/shared'
import { describe, expect, it, vi } from 'vitest'
import { NotesTab } from './NotesTab'
const ann = (o: Partial<AnnotationRow>): AnnotationRow => ({ id:'a1', node_id:'n', kind:'selection', anchor_from:0, anchor_to:2, quoted_text:'x', note:'记', child_node_id:null, created_at:'', ...o })

describe('NotesTab create', () => {
  it('submits a new note on Enter and clears', () => {
    const onCreateNote = vi.fn()
    render(<NotesTab annotations={[]} onJump={() => {}} onCreateNote={onCreateNote} />)
    const input = screen.getByLabelText('new-note-input')
    fireEvent.change(input, { target: { value: '一条新笔记' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateNote).toHaveBeenCalledWith('一条新笔记')
    expect(input).toHaveValue('')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/NotesTab.test.tsx`
Expected: FAIL（无 new-note-input）

- [ ] **Step 3: 实现 NotesTab**

在 `NotesTab` 顶部加：一个受控 textarea（`aria-label="new-note-input"`）+ `usePastedImages` + `ImageThumbs`；`onKeyDown` Enter（非 Shift、非 isComposing）→ `if (value.trim()) { onCreateNote(value.trim()); setValue(''); imgs.clear() }`。列表：`import { useWorkbench }`，读 `anchoredNoteId`；匹配的 `.note-item` 加 `ann-flash`（或 `is-anchored`）类并在 effect 里 `scrollIntoView`，随后 `setAnchoredNoteId(null)`（一次性，类比 focusedAnnotationId）。保持既有空态与列表结构。`onCreateNote` 为新必填 prop。

- [ ] **Step 4: SubdocPanelTabs 改用 store tab + 透传 onCreateNote**

`SubdocPanelTabs`：删局部 `useState`，改 `const tab = useWorkbench(s=>s.subdocPanelTab); const setTab = useWorkbench(s=>s.setSubdocPanelTab)`；tab 按钮 onClick 调 `setTab(...)`。新增 prop `onCreateNote`，传给 `<NotesTab ... onCreateNote={onCreateNote} />`。

- [ ] **Step 5: Workbench + MainDoc 透传 createNote**

问题：createNote 需要当前主文档 nodeId + 追加进 annotations/notesForMain，这些在 `MainDoc`。方案：把「无选区建笔记」做成 store 之外的最小通路——在 `MainDoc` 已有 createNote 逻辑基础上，新增一个 store action `requestCreateNote`? 不必。改用：`Workbench.tsx` 已渲染 `<SubdocPanelTabs annotations={notesForMain} />`；给它加 `onCreateNote`。但 Workbench 无 api/nodeId 上下文。**最简做法**：在 `Workbench.tsx` 用 `useApi()` + `useWorkbench(s=>s.mainNodeId)` 直接实现一个 `createNote`：调用 `api.createNote(mainNodeId, { anchorFrom:null, anchorTo:null, quotedText:null, note })`，成功后 `useWorkbench.getState().setNotesForMain([...notesForMain, res.annotation])`。（MainDoc 的正文高亮不依赖无锚点笔记，无需同步 MainDoc 局部 annotations；列表来源是 store `notesForMain`，会即时更新。）guard：`mainNodeId` 为空时禁用输入/不提交。

- [ ] **Step 6: 运行 NotesTab 测试 + 全量 + tsc**

Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit`
Expected: PASS（现有 SubdocTabs/Workbench/NotesTab 用例保持通过；若某测试断言旧的局部 tab 行为，改为通过 store 断言）

- [ ] **Step 7: 提交**

```bash
git add packages/web/src
git commit -m "feat: 右栏笔记 Tab 支持新建笔记（图片+Enter），Tab 状态入 store，笔记锚定高亮

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: pickAnchorTarget 纯函数 + DocView onClick + MainDoc 路由

**Files:**
- Create: `packages/web/src/doc/anchor-target.ts`
- Create: `packages/web/src/doc/anchor-target.test.ts`
- Modify: `packages/web/src/components/DocView.tsx`
- Modify: `packages/web/src/components/MainDoc.tsx`

**Interfaces:**
- Produces: `pickAnchorTarget(annotations: AnnotationRow[], clickedId: string): { kind: 'branch'; childNodeId: string } | { kind: 'note'; annotationId: string } | null`。
- `DocView` 新增可选 prop `onAnchorClick?(annotationId: string): void`；`.doc-body` onClick 命中 `[data-ann-id]` 时调用。
- `MainDoc` 主 DocView 传 `onAnchorClick`，解析后路由到右栏。

- [ ] **Step 1: pickAnchorTarget 失败测试**

```ts
import { describe, expect, it } from 'vitest'
import type { AnnotationRow } from '@vibe/shared'
import { pickAnchorTarget } from './anchor-target'
const a = (o: Partial<AnnotationRow>): AnnotationRow => ({ id:'', node_id:'n', kind:'selection', anchor_from:0, anchor_to:10, quoted_text:null, note:null, child_node_id:null, created_at:'2026-01-01', ...o })

describe('pickAnchorTarget', () => {
  it('prefers a branch over a note in the overlapping set', () => {
    const anns = [a({ id:'note1', note:'n', anchor_from:0, anchor_to:10 }), a({ id:'fork1', child_node_id:'c1', anchor_from:2, anchor_to:6, created_at:'2026-01-02' })]
    expect(pickAnchorTarget(anns, 'note1')).toEqual({ kind:'branch', childNodeId:'c1' })
  })
  it('picks the earliest branch when several overlap', () => {
    const anns = [a({ id:'f2', child_node_id:'c2', created_at:'2026-01-03' }), a({ id:'f1', child_node_id:'c1', created_at:'2026-01-02' })]
    expect(pickAnchorTarget(anns, 'f2')).toEqual({ kind:'branch', childNodeId:'c1' })
  })
  it('returns a note target when only notes overlap', () => {
    const anns = [a({ id:'note1', note:'n' })]
    expect(pickAnchorTarget(anns, 'note1')).toEqual({ kind:'note', annotationId:'note1' })
  })
  it('returns null for an unknown id', () => {
    expect(pickAnchorTarget([], 'nope')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/doc/anchor-target.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 pickAnchorTarget**

```ts
import type { AnnotationRow } from '@vibe/shared'

type AnchorTarget = { kind: 'branch'; childNodeId: string } | { kind: 'note'; annotationId: string } | null

function overlaps(a: AnnotationRow, from: number, to: number): boolean {
  if (a.anchor_from === null || a.anchor_to === null) return false
  return a.anchor_from < to && a.anchor_to > from
}

export function pickAnchorTarget(annotations: AnnotationRow[], clickedId: string): AnchorTarget {
  const clicked = annotations.find((a) => a.id === clickedId)
  if (!clicked || clicked.anchor_from === null || clicked.anchor_to === null) return null
  const covering = annotations.filter((a) => overlaps(a, clicked.anchor_from!, clicked.anchor_to!))
  const byOrder = (x: AnnotationRow, y: AnnotationRow) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id)
  const branches = covering.filter((a) => a.child_node_id).sort(byOrder)
  if (branches.length) return { kind: 'branch', childNodeId: branches[0].child_node_id! }
  const notes = covering.filter((a) => !a.child_node_id && a.note).sort(byOrder)
  if (notes.length) return { kind: 'note', annotationId: notes[0].id }
  return null
}
```

- [ ] **Step 4: DocView onClick 失败测试 + 实现**

`DocView.test.tsx` 加：渲染带一个批注的 DocView（用现有测试构造 annotations 使正文出现 `<mark data-ann-id="a1">`），传 `onAnchorClick` spy，`fireEvent.click(mark)` → 期望被以 `'a1'` 调用；点非 mark 文本不调用。
实现：`DocView` 加可选 `onAnchorClick?(id: string): void`；`.doc-body` 加 `onClick={(e) => { const el = (e.target as HTMLElement).closest('[data-ann-id]'); const id = el?.getAttribute('data-ann-id'); if (id && onAnchorClick) onAnchorClick(id) }}`。不影响现有 `onSelect`/`onContextSelect`。

Run: `pnpm --filter @vibe/web test -- --run src/components/DocView.test.tsx` → PASS。

- [ ] **Step 5: MainDoc 路由接线**

`MainDoc.tsx` 主 DocView（约 301 行那个）加：
```tsx
onAnchorClick={(annId) => {
  const target = pickAnchorTarget(annotations, annId)
  const s = useWorkbench.getState()
  if (!target) return
  if (target.kind === 'branch') { s.setSubdocPanelTab('derivations'); s.openSubdocTab(target.childNodeId) }
  else { s.setSubdocPanelTab('notes'); s.setAnchoredNoteId(target.annotationId) }
}}
```
（`import { pickAnchorTarget } from '../doc/anchor-target'`。）transcript / 子文档 DocView 不传 `onAnchorClick`。

- [ ] **Step 6: 全量 + tsc + 提交**

```bash
pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src
git commit -m "feat: 点击正文标记按优先分支规则锚定右栏（分支优先，多分支取最早）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: e2e 验收

**Files:** 无（midscene browser；dev :5173/:4000）

- [ ] **Step 1:** 确认 dev 在跑（`curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` = 200）。
- [ ] **Step 2 (#1 气泡):** 选中正文右键→笔记，在气泡笔记框贴一张图（或输入文字）看到缩略图；Enter 提交成功。就此展开同理。
- [ ] **Step 3 (#1 右栏):** 右栏笔记 Tab 顶部输入新笔记 + Enter，列表出现该笔记。
- [ ] **Step 4 (#2 锚定):** 点正文中一条派生分支高亮 → 右栏切「派生分支」并选中该分支卡；点只有笔记的高亮 → 右栏切「笔记」并高亮该条。截图记录。

---

## 自查结论

- Spec 覆盖：#1 图片→T1/T2/T4；#2 锚定→T3/T5；优先分支规则→T5 `pickAnchorTarget`。
- 类型一致：`PastedImage`、`usePastedImages` 返回、`pickAnchorTarget` 返回联合、store 新字段/ setter 在定义与调用处一致。
- 无占位符：各步给出可用代码或明确指向现有测试装配。
- 注意：T4 Step 5 让 `Workbench.tsx` 直接用 `useApi`+`mainNodeId` 建无锚点笔记并更新 `notesForMain`。已确认 `App.tsx` 用 `<ApiProvider>` 包裹 `<Workbench/>`，`useApi()` 在 Workbench 内可用——无需回退。
