# 工作台 UX 升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 8 项工作台交互升级：合并态修复与结论展示、笔记功能与右栏双 Tab、根节点删除、三列拖拽、聚焦动画、右键菜单，最后做全面视觉改版。

**Architecture:** 以 `packages/web` 为主，`workbench-store`（`useSyncExternalStore` 单例）承载跨组件运行态；`packages/server` 仅新增「创建笔记（不 fork）」一个路由；`packages/shared` 无需改类型（笔记复用 `annotations` 表、`child_node_id=null`）。每项功能配单测，分期用 e2e（midscene 浏览器截图）验收。

**Tech Stack:** React 18 + TypeScript + Vite（web，端口 5173，`/api` 代理到 4000）；Fastify + better-sqlite3（server，端口 4000）；vitest（jsdom）单测；midscene `browser` skill 做 e2e。

## Global Constraints

- 包管理用 `pnpm`；web 测试 `pnpm --filter @vibe/web test`，server 测试 `pnpm --filter @vibe/server test`；类型检查 `pnpm --filter @vibe/web exec tsc --noEmit`。
- 提交信息用中文 `feat:`/`fix:`/`docs:` 前缀，结尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 现有测试必须保持全绿（当前 web 77、含本计划新增后递增）。
- 不新增网络字体、不引入新运行时依赖。
- 笔记 = `annotations` 表中 `child_node_id === null` 的行；派生 = 带 `child_node_id` 的行。不新增 `AnnotationKind`（沿用 `'selection'`）。
- 数据类型（勿改）：`AnnotationRow { id, node_id, kind, anchor_from, anchor_to, quoted_text, note, child_node_id, created_at }`；`ContextSegmentRow { id, node_id, seq, type, ref_node_id, ref_version_no, content }`。
- store 现有相关字段：`activeSubdocId, subdocTabs, nodesById, mainNodeId, rootNodeId, treeId, focusMode`；相关 action：`openSubdocTab, setActiveSubdoc, setMain, promoteSubdoc, toggleFocus, setSubtreeDeleted, upsertNode, reset`。

---

## 阶段一：合并相关（#3、#4）

### Task 1: store 增加按节点持久化的合并态（#3）

**Files:**
- Modify: `packages/web/src/state/workbench-store.ts`（`WorkbenchData` 加字段、`initialData`、actions 加 `setMergeState`）
- Test: `packages/web/src/state/workbench-store.test.ts`

**Interfaces:**
- Produces: `state.mergeStateByNodeId: Record<string, 'merging' | 'merged'>`；`setMergeState(nodeId: string, mergeState: 'merging' | 'merged' | null): void`（传 `null` 清除该节点态）。

- [ ] **Step 1: 写失败测试**

在 `workbench-store.test.ts` 末尾（`describe` 内）加：

```ts
it('persists per-node merge state across reads', () => {
  const store = useWorkbench.getState()
  store.setMergeState('node-a', 'merging')
  expect(useWorkbench.getState().mergeStateByNodeId['node-a']).toBe('merging')
  store.setMergeState('node-a', 'merged')
  expect(useWorkbench.getState().mergeStateByNodeId['node-a']).toBe('merged')
  store.setMergeState('node-a', null)
  expect(useWorkbench.getState().mergeStateByNodeId['node-a']).toBeUndefined()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/state/workbench-store.test.ts`
Expected: FAIL（`setMergeState is not a function`）

- [ ] **Step 3: 实现**

在 `WorkbenchData` 接口加：`mergeStateByNodeId: Record<string, 'merging' | 'merged'>`。
在 `initialData()` 返回对象加：`mergeStateByNodeId: {},`。
在 `WorkbenchState` 接口加：`setMergeState(nodeId: string, mergeState: 'merging' | 'merged' | null): void`。
在 `actions` 加：

```ts
setMergeState(nodeId, mergeState) {
  const next = { ...state.mergeStateByNodeId }
  if (mergeState === null) delete next[nodeId]
  else next[nodeId] = mergeState
  patch({ mergeStateByNodeId: next })
},
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/state/workbench-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/state/workbench-store.ts packages/web/src/state/workbench-store.test.ts
git commit -m "feat: store 按节点持久化合并态

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: MergeButton 改用 store 态（#3）

**Files:**
- Modify: `packages/web/src/components/MergeButton.tsx`
- Test: `packages/web/src/components/MergeButton.test.tsx`

**Interfaces:**
- Consumes: `useWorkbench(state => state.mergeStateByNodeId)`、`setMergeState`（Task 1）。
- Produces: `MergeButton` 按 `sourceNodeId` 读态，切走再回来仍显示「已合并」。

- [ ] **Step 1: 写失败测试**

参考现有 `MergeButton.test.tsx` 的 provider 包裹方式。新增用例：合并成功后，卸载并以同 `sourceNodeId` 重新挂载，仍显示「已合并」。

```tsx
it('keeps merged state after remount (tab switch) via store', async () => {
  const api = { merge: vi.fn().mockResolvedValue({}) }
  const { unmount } = render(
    <ApiProvider value={api as never}><MergeButton sourceNodeId="s1" targetNodeId="p1" /></ApiProvider>,
  )
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByText('已合并')).toBeInTheDocument()
  unmount()
  render(
    <ApiProvider value={api as never}><MergeButton sourceNodeId="s1" targetNodeId="p1" /></ApiProvider>,
  )
  expect(screen.getByText('已合并')).toBeInTheDocument()
})
```

（导入：从 `@testing-library/react` 取 `render, screen, fireEvent`；`vi` 来自 vitest globals；`ApiProvider` 路径与现有测试一致。若现有测试用不同的 provider 包法，沿用之。测试后需重置 store：在此文件顶部 `import { useWorkbench } from '../state/workbench-store'` 并在 `afterEach(() => useWorkbench.getState().reset())`。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/MergeButton.test.tsx`
Expected: FAIL（重挂载后「已合并」不在）

- [ ] **Step 3: 实现**

改写 `MergeButton.tsx`：移除 `merged` 的本地 `useState`，改为读 store；`busy` 可保留本地（瞬时），也可用 store。最小实现：

```tsx
import { useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'

export function MergeButton({ onMerged, sourceNodeId, targetNodeId }: {
  onMerged?(): void; sourceNodeId: string; targetNodeId: string
}) {
  const api = useApi()
  const mergeState = useWorkbench((s) => s.mergeStateByNodeId[sourceNodeId])
  const setMergeState = useWorkbench((s) => s.setMergeState)
  const [error, setError] = useState<string | null>(null)

  if (mergeState === 'merged') return <span className="merge-toast" role="status">已合并</span>
  const busy = mergeState === 'merging'
  return (
    <div className="merge-action">
      <button disabled={busy} onClick={() => {
        setMergeState(sourceNodeId, 'merging')
        setError(null)
        void api.merge(sourceNodeId, targetNodeId)
          .then(() => { setMergeState(sourceNodeId, 'merged'); onMerged?.() })
          .catch(() => { setMergeState(sourceNodeId, null); setError('合并失败，子分支仍完整保留。') })
      }} type="button">
        {busy ? '合并中…' : '合并回父节点'}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/components/MergeButton.test.tsx`
Expected: PASS（现有用例 + 新用例都过）

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/MergeButton.tsx packages/web/src/components/MergeButton.test.tsx
git commit -m "fix: 合并态提到 store，切换 tab 后不再丢失

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: 父文档展示合并结论（#4）

**Files:**
- Create: `packages/web/src/components/MergedConclusions.tsx`
- Create: `packages/web/src/components/MergedConclusions.test.tsx`
- Modify: `packages/web/src/components/MainDoc.tsx`（保存并传入 segments）

**Interfaces:**
- Consumes: `getNode` 返回的 `segments: ContextSegmentRow[]`；`renderMarkdown`（`../doc/markdown`）；`nodeTitle`（`./TreePanel`）；`useWorkbench(s => s.nodesById)`。
- Produces: `<MergedConclusions segments={ContextSegmentRow[]} />`，渲染 `type === 'merged-conclusion'` 的段落。

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen } from '@testing-library/react'
import type { ContextSegmentRow } from '@vibe/shared'
import { describe, expect, it } from 'vitest'
import { MergedConclusions } from './MergedConclusions'

describe('MergedConclusions', () => {
  const seg = (over: Partial<ContextSegmentRow>): ContextSegmentRow => ({
    id: 'x', node_id: 'p1', seq: 1, type: 'merged-conclusion',
    ref_node_id: null, ref_version_no: null, content: null, ...over,
  })
  it('renders merged-conclusion segments as markdown', () => {
    render(<MergedConclusions segments={[seg({ content: '**要点**：内存更快' })]} />)
    expect(screen.getByText('要点', { exact: false })).toBeInTheDocument()
    expect(document.querySelector('strong')?.textContent).toBe('要点')
  })
  it('renders nothing when there are no merged-conclusion segments', () => {
    const { container } = render(<MergedConclusions segments={[seg({ type: 'ancestor-full', content: 'x' })]} />)
    expect(container.querySelector('[data-testid="merged-conclusions"]')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/MergedConclusions.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```tsx
import type { ContextSegmentRow } from '@vibe/shared'
import { renderMarkdown } from '../doc/markdown'

export function MergedConclusions({ segments }: { segments: ContextSegmentRow[] }) {
  const merged = segments.filter((s) => s.type === 'merged-conclusion' && s.content)
  if (merged.length === 0) return null
  return (
    <section className="merged-conclusions" data-testid="merged-conclusions">
      <h3>合并结论</h3>
      {merged.map((s) => (
        <div className="merged-conclusion-item" key={s.id}>
          <div className="doc-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.content ?? '') }} />
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/components/MergedConclusions.test.tsx`
Expected: PASS

- [ ] **Step 5: 接入 MainDoc**

在 `MainDoc.tsx`：
1. 顶部 import：`import { MergedConclusions } from './MergedConclusions'`，以及 `import type { ContextSegmentRow } from '@vibe/shared'`（若未导入）。
2. 加 state：`const [segments, setSegments] = useState<ContextSegmentRow[]>([])`。
3. 在现有 `getNode(mainNodeId).then(result => {...})`（约 69-73 行）里补：`setSegments(result.segments)`；并在 effect 顶部重置区（约 58-63 行 `setAnnotations([])` 附近）加 `setSegments([])`。
4. 在主文档 `DocView`（约 275 行 `onSelect={setSelection} />` 之后）下面插入：`<MergedConclusions segments={segments} />`。

- [ ] **Step 6: 运行全量 web 测试 + 类型检查**

Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit`
Expected: PASS，tsc exit 0

- [ ] **Step 7: 提交**

```bash
git add packages/web/src/components/MergedConclusions.tsx packages/web/src/components/MergedConclusions.test.tsx packages/web/src/components/MainDoc.tsx
git commit -m "feat: 父文档展示合并结论（merged-conclusion segments）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: 阶段一 e2e 验收（#3、#4）

**Files:** 无（手动 e2e，用 midscene `browser` skill）

- [ ] **Step 1: 确认 dev 环境**

确认 server（:4000）与 web（:5173）dev 在跑；不在则启动：`pnpm --filter @vibe/server dev` 与 `pnpm --filter @vibe/web dev`（后台）。用 `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` 确认返回 200。

- [ ] **Step 2: 走查合并流程**

用 `browser` skill：打开 `http://localhost:5173`，选一个有派生子分支的节点，在右栏点「合并回父节点」，截图确认按钮变「合并中…」→「已合并」；点其它派生 tab 再切回，截图确认仍「已合并」（验收 #3）。

- [ ] **Step 3: 走查父文档结论**

聚焦回父节点，截图确认主文档正文下方出现「合并结论」区块且内容非空（验收 #4）。若无真实数据，先在 UI 里对某子分支执行一次合并再验。

- [ ] **Step 4: 记录结果**

把关键截图路径与结论写入本 Task 勾选说明。全绿则阶段一完成。

---

## 阶段二：笔记与右栏双 Tab（#2）

### Task 5: 后端「创建笔记（不 fork）」路由

**Files:**
- Create: `packages/server/src/routes/annotation.ts`
- Create: `packages/server/src/routes/annotation.test.ts`
- Modify: `packages/server/src/app.ts`（注册路由）

**Interfaces:**
- Consumes: `app.deps.nodes.get`、`app.deps.annotations.create`（已存在，返回 `AnnotationRow`）。
- Produces: `POST /api/nodes/:id/annotation`，body `{ anchorFrom: number|null, anchorTo: number|null, quotedText: string|null, note: string }`，成功返回 `{ annotation: AnnotationRow }`（`child_node_id` 恒为 `null`）。

- [ ] **Step 1: 写失败测试**

参考现有 `packages/server/src/routes/fork.test.ts` 的 app 构建/inject 方式，新建 `annotation.test.ts`：

```ts
// 构建 app 的方式与 fork.test.ts 保持一致（同样的 buildTestApp / deps 装配）
it('creates a note annotation without a child node', async () => {
  // 先建树拿到 rootNode.id（沿用 fork.test.ts 的建树辅助）
  const res = await app.inject({
    method: 'POST', url: `/api/nodes/${rootId}/annotation`,
    payload: { anchorFrom: 0, anchorTo: 3, quotedText: '内存快', note: '待验证' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.annotation.note).toBe('待验证')
  expect(body.annotation.child_node_id).toBeNull()
})

it('rejects empty note', async () => {
  const res = await app.inject({
    method: 'POST', url: `/api/nodes/${rootId}/annotation`,
    payload: { anchorFrom: 0, anchorTo: 3, quotedText: '内存快', note: '   ' },
  })
  expect(res.statusCode).toBe(400)
})
```

（建树与 app 装配的确切写法：打开 `fork.test.ts` 复制其 `beforeEach`/helper，`rootId` 取建树返回的 root 节点 id。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/server test -- --run src/routes/annotation.test.ts`
Expected: FAIL（404 或路由不存在）

- [ ] **Step 3: 实现路由**

```ts
import type { DecoratedApp } from '../app'

function bodyRecord(body: unknown): Record<string, unknown> | undefined {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>) : undefined
}
function nullableNumber(v: unknown): number | null | undefined {
  return v === null || (typeof v === 'number' && Number.isInteger(v)) ? v : undefined
}
function nullableString(v: unknown): string | null | undefined {
  return v === null || typeof v === 'string' ? v : undefined
}

export function registerAnnotationRoutes(app: DecoratedApp): void {
  app.post('/api/nodes/:id/annotation', async (request, reply) => {
    const body = bodyRecord(request.body)
    const anchorFrom = nullableNumber(body?.anchorFrom ?? null)
    const anchorTo = nullableNumber(body?.anchorTo ?? null)
    const quotedText = nullableString(body?.quotedText ?? null)
    const note = typeof body?.note === 'string' ? body.note : undefined
    if (anchorFrom === undefined || anchorTo === undefined || quotedText === undefined || !note || !note.trim()) {
      return reply.code(400).send({ error: 'invalid annotation body' })
    }
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) {
      return reply.code(404).send({ error: 'node not found' })
    }
    const annotation = app.deps.annotations.create({
      anchorFrom, anchorTo, kind: 'selection', nodeId: node.id, note: note.trim(), quotedText,
    })
    return { annotation }
  })
}
```

在 `app.ts`：加 `import { registerAnnotationRoutes } from './routes/annotation'`，并在其它 `register*Routes(app)` 调用处加 `registerAnnotationRoutes(app)`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/server test -- --run src/routes/annotation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/annotation.ts packages/server/src/routes/annotation.test.ts packages/server/src/app.ts
git commit -m "feat: 新增创建笔记路由 POST /nodes/:id/annotation（不 fork）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 6: client 增加 createNote + store 笔记回跳态

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/state/workbench-store.ts`
- Test: `packages/web/src/api/client.test.ts`、`packages/web/src/state/workbench-store.test.ts`

**Interfaces:**
- Produces: `api.createNote(nodeId, { anchorFrom, anchorTo, quotedText, note })` → `Promise<{ annotation: AnnotationRow }>`；store `focusedAnnotationId: string | null` + `setFocusedAnnotation(id: string | null): void`。

- [ ] **Step 1: 写失败测试（client）**

在 `client.test.ts` 加：断言 `createNote` 用正确 URL/method/body 调 fetch，并解析返回 `annotation`。（沿用该文件已有的 `fetchImpl` mock 模式。）

```ts
it('createNote posts to /nodes/:id/annotation', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ annotation: { id: 'a1' } }),
  })
  const api = createApi({ fetchImpl })
  const out = await api.createNote('n1', { anchorFrom: 0, anchorTo: 3, quotedText: 'x', note: '记一下' })
  expect(fetchImpl).toHaveBeenCalledWith('/api/nodes/n1/annotation', expect.objectContaining({ method: 'POST' }))
  expect(out.annotation.id).toBe('a1')
})
```

- [ ] **Step 2: 写失败测试（store）**

在 `workbench-store.test.ts` 加：

```ts
it('tracks focused annotation for note jump', () => {
  useWorkbench.getState().setFocusedAnnotation('ann-1')
  expect(useWorkbench.getState().focusedAnnotationId).toBe('ann-1')
  useWorkbench.getState().setFocusedAnnotation(null)
  expect(useWorkbench.getState().focusedAnnotationId).toBeNull()
})
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/api/client.test.ts src/state/workbench-store.test.ts`
Expected: FAIL（`createNote`/`setFocusedAnnotation` 未定义）

- [ ] **Step 4: 实现**

`client.ts`：在返回对象里（`createTree` 附近）加：

```ts
createNote: (
  nodeId: string,
  body: { anchorFrom: number | null; anchorTo: number | null; quotedText: string | null; note: string },
) =>
  json<{ annotation: AnnotationRow }>(`/nodes/${nodeId}/annotation`, {
    body: JSON.stringify(body), method: 'POST',
  }),
```

`workbench-store.ts`：`WorkbenchData` 加 `focusedAnnotationId: string | null`；`initialData` 加 `focusedAnnotationId: null,`；`WorkbenchState` 加 `setFocusedAnnotation(id: string | null): void`；actions 加：

```ts
setFocusedAnnotation(id) { patch({ focusedAnnotationId: id }) },
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/api/client.test.ts src/state/workbench-store.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/api/client.ts packages/web/src/state/workbench-store.ts packages/web/src/api/client.test.ts packages/web/src/state/workbench-store.test.ts
git commit -m "feat: client createNote + store 笔记聚焦态

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 7: MainDoc 保存笔记 + 高亮回跳；NotesTab + 右栏双 Tab

**Files:**
- Create: `packages/web/src/components/NotesTab.tsx`
- Create: `packages/web/src/components/NotesTab.test.tsx`
- Create: `packages/web/src/components/SubdocPanelTabs.tsx`
- Modify: `packages/web/src/components/MainDoc.tsx`（`onCreateNote` 落库 + 监听 `focusedAnnotationId` 滚动高亮）
- Modify: `packages/web/src/components/Workbench.tsx`（右栏用 `SubdocPanelTabs` 替换直接的 `SubdocTabs`）
- Modify: `packages/web/src/components/DocView.tsx`（给 mark 加可滚动定位能力——已有 `data-ann-id`，无需改结构；仅确认）

**Interfaces:**
- Consumes: `api.createNote`（Task 6）、`setFocusedAnnotation`/`focusedAnnotationId`（Task 6）、`useWorkbench(s=>s.nodesById)`、现有 `annotations` state。
- Produces: `<NotesTab annotations={AnnotationRow[]} onJump={(id) => void} />`；`<SubdocPanelTabs />` 内含「派生分支/笔记」两个 tab。

- [ ] **Step 1: NotesTab 失败测试**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import type { AnnotationRow } from '@vibe/shared'
import { describe, expect, it, vi } from 'vitest'
import { NotesTab } from './NotesTab'

const ann = (over: Partial<AnnotationRow>): AnnotationRow => ({
  id: 'a1', node_id: 'n1', kind: 'selection', anchor_from: 0, anchor_to: 3,
  quoted_text: '内存快', note: '待验证', child_node_id: null, created_at: '', ...over,
})

describe('NotesTab', () => {
  it('lists only note annotations (child_node_id null) and fires onJump', () => {
    const onJump = vi.fn()
    render(<NotesTab annotations={[ann({}), ann({ id: 'a2', child_node_id: 'c1', note: null })]} onJump={onJump} />)
    expect(screen.getByText('待验证')).toBeInTheDocument()
    fireEvent.click(screen.getByText('待验证'))
    expect(onJump).toHaveBeenCalledWith('a1')
  })
  it('shows empty state when no notes', () => {
    render(<NotesTab annotations={[]} onJump={() => {}} />)
    expect(screen.getByText('还没有笔记')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/NotesTab.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 NotesTab**

```tsx
import type { AnnotationRow } from '@vibe/shared'

export function NotesTab({ annotations, onJump }: {
  annotations: AnnotationRow[]; onJump(annotationId: string): void
}) {
  const notes = annotations.filter((a) => a.child_node_id === null && a.note)
  if (notes.length === 0) return <p className="empty-state">还没有笔记</p>
  return (
    <ul className="notes-list">
      {notes.map((n) => (
        <li className="note-item" key={n.id}>
          <button onClick={() => onJump(n.id)} type="button">
            {n.quoted_text && <blockquote>{n.quoted_text}</blockquote>}
            <span className="note-body">{n.note}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/components/NotesTab.test.tsx`
Expected: PASS

- [ ] **Step 5: 实现 SubdocPanelTabs**

```tsx
import { useState } from 'react'
import { useWorkbench } from '../state/workbench-store'
import { NotesTab } from './NotesTab'
import { SubdocTabs } from './SubdocTabs'

export function SubdocPanelTabs({ annotations }: {
  annotations: import('@vibe/shared').AnnotationRow[]
}) {
  const [tab, setTab] = useState<'derivations' | 'notes'>('derivations')
  const setFocusedAnnotation = useWorkbench((s) => s.setFocusedAnnotation)
  return (
    <div className="subdoc-panel-tabs">
      <div className="panel-tab-bar" role="tablist">
        <button aria-selected={tab === 'derivations'} onClick={() => setTab('derivations')} role="tab" type="button">派生分支</button>
        <button aria-selected={tab === 'notes'} onClick={() => setTab('notes')} role="tab" type="button">笔记</button>
      </div>
      {tab === 'derivations'
        ? <SubdocTabs />
        : <NotesTab annotations={annotations} onJump={(id) => setFocusedAnnotation(id)} />}
    </div>
  )
}
```

- [ ] **Step 6: 接入 Workbench + MainDoc**

`Workbench.tsx`：注意 `annotations` 目前是 `MainDoc` 内部 state，右栏拿不到。方案：把 `annotations` 提到 store 或改由右栏自取。**最小改动**：让 `SubdocPanelTabs` 自己用 `useWorkbench(s=>s.mainNodeId)` + 一个新的 store 字段 `annotationsByNodeId`。但为控制范围，改为：`MainDoc` 通过 store 暴露当前笔记。具体：
  - 在 store 加 `notesForMain: AnnotationRow[]` + `setNotesForMain(rows: AnnotationRow[]): void`（同 Task 6 风格；补对应单测断言 set/读）。
  - `MainDoc` 在 `getNode` 成功后 `setNotesForMain(result.annotations)`；创建笔记成功后把新 annotation 追加进去（同时更新本地 `annotations` 供正文高亮）。
  - `Workbench.tsx` 右栏渲染 `<SubdocPanelTabs annotations={useWorkbench(s=>s.notesForMain)} />`。

`MainDoc.tsx` 的 `onCreateNote` 从空操作改为：

```tsx
onCreateNote={(noteText) => {
  if (!selection) { setSelection(null); return }
  void api.createNote(node.id, {
    anchorFrom: selection.from, anchorTo: selection.to,
    quotedText: selection.text, note: noteText,
  }).then((res) => {
    setAnnotations((cur) => [...cur, res.annotation])
    const add = useWorkbench.getState().setNotesForMain
    add([...useWorkbench.getState().notesForMain, res.annotation])
  }).catch(() => setError('笔记保存失败，请重试。'))
  setSelection(null)
}}
```

- [ ] **Step 7: MainDoc 监听 focusedAnnotationId 滚动高亮**

在 `MainDoc.tsx` 加 effect：

```tsx
const focusedAnnotationId = useWorkbench((s) => s.focusedAnnotationId)
useEffect(() => {
  if (!focusedAnnotationId) return
  const el = scrollRef.current?.querySelector(`[data-ann-id="${focusedAnnotationId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ann-flash')
    const t = setTimeout(() => el.classList.remove('ann-flash'), 1200)
    return () => clearTimeout(t)
  }
}, [focusedAnnotationId])
```

（`.ann-flash` 的样式在阶段四视觉阶段统一定；本步可先加一条最简 `.ann-flash { outline: 2px solid #d6a84e; }` 到 `Workbench.css`。）

- [ ] **Step 8: 全量 web 测试 + 类型检查**

Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit`
Expected: PASS，tsc exit 0

- [ ] **Step 9: 提交**

```bash
git add packages/web/src
git commit -m "feat: 笔记落库 + 右栏派生/笔记双 Tab + 点击回跳高亮

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 8: 阶段二 e2e 验收（#2）

**Files:** 无（midscene `browser`）

- [ ] **Step 1:** 确认 dev 环境在跑（同 Task 4 Step 1）。
- [ ] **Step 2:** 打开工作台，选中主文档正文一段，通过气泡「保存笔记」；截图确认无报错、正文该段出现高亮。
- [ ] **Step 3:** 右栏切到「笔记」tab，截图确认新笔记出现在列表；点击该笔记，截图确认主文档滚动到对应位置并短暂高亮（验收 #2）。
- [ ] **Step 4:** 右栏切回「派生分支」，确认原有派生内容与合并按钮仍正常。记录截图与结论。

---

## 阶段三：删根 = 删树（#5）

### Task 9: TreePanel 根节点删除走删树

**Files:**
- Modify: `packages/web/src/components/TreePanel.tsx`
- Test: `packages/web/src/components/TreePanel.test.tsx`

**Interfaces:**
- Consumes: `api.deleteTree(treeId)`（已存在）、`useWorkbench(s=>s.treeId)`、`reset`。
- Produces: 根节点显示删除按钮；点击 → confirm → `deleteTree` → `reset()`。

- [ ] **Step 1: 写失败测试**

在 `TreePanel.test.tsx` 加：mock `window.confirm` 返回 true 与 `api.deleteTree`；渲染一棵仅根的树；点击根的删除按钮，断言 `api.deleteTree` 被以 `treeId` 调用。（沿用该文件既有的 store 装配 `loadTree` 与 provider 包法。）

```tsx
it('root delete button triggers deleteTree', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const api = { deleteTree: vi.fn().mockResolvedValue({ ok: true }) }
  // loadTree({ nodes:[root], rootNodeId: root.id, treeId: 't1' }) —— 用既有 helper
  render(/* ApiProvider(api) 包 <TreePanel/> */)
  fireEvent.click(screen.getByLabelText(/删除.*根/))
  expect(api.deleteTree).toHaveBeenCalledWith('t1')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/TreePanel.test.tsx`
Expected: FAIL（根无删除按钮 / 未调 deleteTree）

- [ ] **Step 3: 实现**

`TreePanel.tsx`：
1. `TreeBranch` 的删除按钮条件从 `{node.parent_id && (...)}` 改为始终渲染，但 `onDelete` 区分：根（无 `parent_id`）走删树、非根走现有子树删除。做法：给 `TreeBranch` 的 `onDelete` 传节点 id，`TreePanel.handleDelete` 内部判断：

```tsx
async function handleDelete(id: string): Promise<void> {
  const node = nodesById[id]
  const treeId = useWorkbench.getState().treeId
  if (node && !node.parent_id) {
    if (!window.confirm(`将删除整棵树"${nodeTitle(node)}"，可在回收站/树列表恢复。`)) return
    try { await api.deleteTree(treeId!); useWorkbench.getState().reset() }
    catch { setError('删除树失败，请稍后重试。') }
    return
  }
  // ...现有子树软删逻辑不变...
}
```
2. `TreeBranch` 里移除 `{node.parent_id && (...)}` 对删除按钮的包裹（改为始终渲染删除按钮）；根按钮的 `aria-label` 会是 `删除"根"`，与测试匹配。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/components/TreePanel.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量 + 提交**

```bash
pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/components/TreePanel.tsx packages/web/src/components/TreePanel.test.tsx
git commit -m "feat: 根节点可删除（走删树，可恢复）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 10: 阶段三 e2e 验收（#5）

- [ ] **Step 1:** dev 环境在跑。
- [ ] **Step 2:** 打开工作台，对非根派生节点点删除，截图确认进回收站、可撤销（回归现有行为）。
- [ ] **Step 3:** 对根节点点删除，确认弹「将删除整棵树」，确认后树从列表消失；到树列表/回收站确认可恢复（验收 #5）。记录截图。

---

## 阶段四：拖拽、聚焦动画、右键菜单（#1、#6、#7）

### Task 11: 三列拖拽宽度（#1）

**Files:**
- Create: `packages/web/src/flow/use-column-resize.ts`
- Create: `packages/web/src/flow/use-column-resize.test.ts`
- Modify: `packages/web/src/components/Workbench.tsx`（渲染两个把手）
- Modify: `packages/web/src/components/Workbench.css`（grid 用变量）

**Interfaces:**
- Produces: `useColumnResize()` → `{ leftWidth: number, rightWidth: number, startDrag(side: 'left'|'right', clientX: number): void, resetSide(side: 'left'|'right'): void }`；读写 `localStorage['workbench.cols']`。

- [ ] **Step 1: 写失败测试**

```ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useColumnResize } from './use-column-resize'

describe('useColumnResize', () => {
  beforeEach(() => localStorage.clear())
  it('clamps left width to a minimum', () => {
    const { result } = renderHook(() => useColumnResize())
    act(() => { result.current.startDrag('left', 1000) })
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 })) }) // 拖到极窄
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
    expect(result.current.leftWidth).toBeGreaterThanOrEqual(180)
  })
  it('persists width to localStorage', () => {
    const { result } = renderHook(() => useColumnResize())
    act(() => { result.current.resetSide('left') })
    expect(localStorage.getItem('workbench.cols')).not.toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/flow/use-column-resize.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hook**

要点：初始 `leftWidth=280`、`rightWidth=360`（读 localStorage 覆盖）；`startDrag` 记录起始 clientX 与起始宽度，注册 `mousemove`/`mouseup`（`mouseup` 时解绑并写 localStorage）；`mousemove` 里按 side 计算新宽并夹取（left ∈ [180, innerWidth*0.5]，right ∈ [260, innerWidth*0.5]）；`resetSide` 恢复默认并写盘。用 `useState` + `useRef` 存拖拽上下文；`Date.now()` 不可用不涉及。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vibe/web test -- --run src/flow/use-column-resize.test.ts`
Expected: PASS

- [ ] **Step 5: 接入 Workbench + CSS**

`Workbench.css`：`.workbench` 的 `grid-template-columns` 改 `var(--col-left, 280px) minmax(360px, 1fr) var(--col-right, 360px)`；`.workbench[data-focus='true']` 保持 2 列不变（不读变量）。加把手样式 `.col-resizer{ width:6px; cursor:col-resize; ... }`。
`Workbench.tsx`：调用 `useColumnResize()`，把 `leftWidth/rightWidth` 通过内联 style 写到 `.workbench` 的 `--col-left/--col-right`；在树面板与主文档之间、主文档与右栏之间各渲染一个 `<div role="separator" aria-orientation="vertical" className="col-resizer" onMouseDown={e=>startDrag('left', e.clientX)} onDoubleClick={()=>resetSide('left')} />`（右侧同理 'right'）。聚焦模式下不渲染把手（`{!focusMode && ...}`）。

- [ ] **Step 6: 全量 + 提交**

```bash
pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/flow/use-column-resize.ts packages/web/src/flow/use-column-resize.test.ts packages/web/src/components/Workbench.tsx packages/web/src/components/Workbench.css
git commit -m "feat: 三列宽度可拖拽（含最小宽度夹取与本地持久化）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 12: 聚焦切换动画（#6）

**Files:**
- Modify: `packages/web/src/components/Workbench.tsx`（聚焦隐藏从 `hidden` 改 CSS 类）
- Modify: `packages/web/src/components/Workbench.css`
- Test: `packages/web/src/components/Workbench.test.tsx`（断言聚焦时面板带隐藏类而非 `hidden` 属性）

- [ ] **Step 1: 写失败测试**

```tsx
it('focus mode hides side panels via class (animatable), not hidden attribute', () => {
  // loadTree + 进入 focus（toggleFocus）
  render(/* <Workbench/> with tree loaded */)
  fireEvent.click(screen.getByRole('button', { name: /沉浸聚焦/ }))
  const tree = screen.getByTestId('tree-panel')
  expect(tree.hasAttribute('hidden')).toBe(false)
  expect(tree.className).toMatch(/is-collapsed/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vibe/web test -- --run src/components/Workbench.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现**

`Workbench.tsx`：树面板 `hidden={focusMode}` 改为 `className={`tree-panel ${focusMode ? 'is-collapsed' : ''}`}`（去掉 `hidden`）。右栏同样加 `is-collapsed`（聚焦时右栏也收）。
`Workbench.css`：`.tree-panel, .subdoc-panel { transition: width .24s ease, opacity .24s ease; }`；`.is-collapsed { width:0; min-width:0; padding-left:0; padding-right:0; opacity:0; overflow:hidden; visibility:hidden; }`；`.workbench { transition: grid-template-columns .24s ease; }`；`@media (prefers-reduced-motion: reduce){ .tree-panel,.subdoc-panel,.workbench{ transition:none; } }`。

- [ ] **Step 4: 运行确认通过 + 提交**

```bash
pnpm --filter @vibe/web test -- --run src/components/Workbench.test.tsx && pnpm --filter @vibe/web exec tsc --noEmit
git add packages/web/src/components/Workbench.tsx packages/web/src/components/Workbench.css packages/web/src/components/Workbench.test.tsx
git commit -m "feat: 聚焦切换加过渡动画（尊重 prefers-reduced-motion）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 13: 右键菜单驱动气泡（#7）

**Files:**
- Create: `packages/web/src/components/SelectionMenu.tsx`
- Create: `packages/web/src/components/SelectionMenu.test.tsx`
- Modify: `packages/web/src/components/DocView.tsx`（`onContextMenu` + 不再选中即派发气泡）
- Modify: `packages/web/src/components/MainDoc.tsx`（用菜单结果决定气泡初始焦点）

**Interfaces:**
- Produces: `<SelectionMenu x={number} y={number} onPick={(kind:'note'|'expand')=>void} onClose={()=>void} />`。
- 变更：`DocView` 新增可选 prop `onContextSelect(selection: PlainSelection, x: number, y: number): void`；有选区时右键触发它并 `preventDefault`。选中不再自动 `onSelect` 弹气泡（`onSelect` 仍在但仅用于记录选区，气泡展示由 MainDoc 根据菜单结果控制）。

- [ ] **Step 1: SelectionMenu 失败测试**

```tsx
it('renders two actions and fires onPick', () => {
  const onPick = vi.fn()
  render(<SelectionMenu x={10} y={10} onPick={onPick} onClose={() => {}} />)
  fireEvent.click(screen.getByText('就此展开'))
  expect(onPick).toHaveBeenCalledWith('expand')
})
```

- [ ] **Step 2: 运行确认失败 →  实现 SelectionMenu**

```tsx
export function SelectionMenu({ x, y, onPick, onClose }: {
  x: number; y: number; onPick(kind: 'note' | 'expand'): void; onClose(): void
}) {
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="selection-menu" role="menu" style={{ left: x, top: y, position: 'fixed' }}>
        <button onClick={() => onPick('note')} role="menuitem" type="button">笔记</button>
        <button onClick={() => onPick('expand')} role="menuitem" type="button">就此展开</button>
      </div>
    </>
  )
}
```

Run: `pnpm --filter @vibe/web test -- --run src/components/SelectionMenu.test.tsx` → PASS。

- [ ] **Step 3: DocView 接线**

`DocView.tsx`：`captureSelection` 保留（记录选区）。新增 `onContextMenu`：若当前有选区文本，`event.preventDefault()` 并调用新 prop `onContextSelect(selection, event.clientX, event.clientY)`。`onSelect` 仍在 mouseup 记录选区，但不再由此弹气泡（气泡是否显示由父层状态控制）。

- [ ] **Step 4: MainDoc 接线**

`MainDoc.tsx`：新增 state `menu: { x:number; y:number } | null` 与 `bubbleMode: 'note'|'expand'|null`。`DocView` 传 `onContextSelect={(sel,x,y)=>{ setSelection(sel); setMenu({x,y}) }}`。渲染：`menu && <SelectionMenu x={menu.x} y={menu.y} onPick={(k)=>{ setBubbleMode(k); setMenu(null) }} onClose={()=>setMenu(null)} />`。`AnnotationBubble` 仅在 `selection && bubbleMode` 时渲染，并把 `bubbleMode` 传入用于决定初始聚焦（`AnnotationBubble` 加可选 prop `initialFocus?: 'note'|'expand'`，在对应 `textarea` 上 `autoFocus`）。关闭气泡时 `setBubbleMode(null)`。

- [ ] **Step 5: 更新 AnnotationBubble 初始焦点**

`AnnotationBubble.tsx`：加 prop `initialFocus?: 'note' | 'expand'`；把现有笔记 `textarea` 的 `autoFocus` 改为 `autoFocus={initialFocus !== 'expand'}`，追问 `textarea` 加 `autoFocus={initialFocus === 'expand'}`。更新 `AnnotationBubble.test.tsx` 若断言了 autoFocus 行为。

- [ ] **Step 6: 全量 web 测试 + 类型检查**

Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add packages/web/src
git commit -m "feat: 选中文字改由右键菜单唤起笔记/就此展开气泡

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 14: 阶段四 e2e 验收（#1、#6、#7）

- [ ] **Step 1:** dev 环境在跑。
- [ ] **Step 2 (#1):** 拖动左右两个把手，截图确认列宽变化并有最小宽度；刷新页面确认宽度保留;双击把手复位。
- [ ] **Step 3 (#6):** 点「沉浸聚焦」与「退出聚焦」，录制/连续截图确认左右栏平滑收合而非瞬跳。
- [ ] **Step 4 (#7):** 选中正文一段，确认不再自动弹气泡；右键出现「笔记/就此展开」菜单；分别点两项确认气泡出现且初始焦点正确。记录截图。

---

## 阶段五：全面视觉改版（#8，最后）

### Task 15: 设计方向预览（先出方向，经确认）

**Files:** 由 designer 产出（预览用独立 HTML/截图，不改主代码）

- [ ] **Step 1:** 用 `oh-my-claudecode:designer` 基于 #1–#7 完成后的最终界面，产出 2–3 个关键界面（主文档+合并结论、右栏双 Tab、右键菜单+拖拽）的视觉方向预览（配色/排版/组件风格）。
- [ ] **Step 2:** 截图呈现给用户确认方向（用户已选「全面改版」，允许偏离现有暖色纸感，但需先确认再落地，便于回退）。
- [ ] **Step 3:** 记录被选方向。

### Task 16: 落地视觉改版到 Workbench.css（及必要的组件类名）

**Files:**
- Modify: `packages/web/src/components/Workbench.css`（主要）
- Modify: 相关组件仅在需要新类名/结构时改（尽量只动 className）
- 验收：无单测（视觉），但**所有现有单测必须仍绿**、`tsc` 干净。

- [ ] **Step 1:** designer 按选定方向落地样式，覆盖：三列+把手、右栏双 Tab、笔记列表、合并结论区块、右键菜单、聚焦动画、气泡、表格（沿用前期已修的表格样式）。
- [ ] **Step 2:** Run: `pnpm --filter @vibe/web test && pnpm --filter @vibe/web exec tsc --noEmit` → 全绿。
- [ ] **Step 3:** e2e：用 `browser` skill 对全流程截图，人工确认视觉与交互，逐屏对照方向预览。
- [ ] **Step 4:** 提交。

```bash
git add packages/web/src
git commit -m "feat: 工作台全面视觉改版（#8）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 自查（Self-Review）结论

- **Spec 覆盖**：#1→T11、#2→T5/6/7、#3→T1/2、#4→T3、#5→T9、#6→T12、#7→T13、#8→T15/16。每个 e2e 阶段（T4/8/10/14/16）对应验收。
- **类型一致**：`setMergeState`、`setFocusedAnnotation`、`setNotesForMain`、`createNote`、`useColumnResize` 返回结构、`SelectionMenu`/`NotesTab`/`MergedConclusions` props 在定义与调用处一致。
- **无占位符**：所有代码步骤给出可用代码；少数「沿用现有测试装配」处明确指向具体现有文件（`fork.test.ts`、`MergeButton.test.tsx`、`TreePanel.test.tsx`）。
- **注意点**：T7 Step 6 引入 store `notesForMain` + `setNotesForMain`（需补一条 store 单测，风格同 Task 1/6），执行时补上。
