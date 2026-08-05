# 树形对话工作台 v1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地 web 工具，把 AI 对话建模成一棵"树即文档"，支持批注式分叉、并行路由、合并回填、节点版本管理，用三栏交互随时回到任意分支的上下文。

**Architecture:** monorepo（pnpm workspace）。后端 Node+Fastify+TypeScript，SQLite（better-sqlite3）存储，Provider 抽象层默认 Codex，SSE 流式作答。前端 Vite+React+TypeScript，TipTap/ProseMirror 渲染带批注的 AI 回复，三栏动态角色布局。核心是 ContextSegment 上下文段引擎——分叉/合并/版本都归约为对段列表的操作。

**Tech Stack:** pnpm workspace · Node 22 · Fastify · better-sqlite3 · TypeScript · Vitest · Vite · React · TipTap(ProseMirror) · SSE · Zod（校验）

## Global Constraints

- 运行环境：Node 22.x，包管理器 pnpm 10.x（workspace）。
- 语言：全栈 TypeScript，`strict: true`。
- 存储：SQLite，通过 better-sqlite3（同步 API）。所有删除为**软删除**（`is_deleted` 标记），数据永不物理删除。
- AI 回复正文存 **ProseMirror JSON**（不是纯文本）。
- Provider 默认 **Codex**，通过可插拔抽象层接入；模型/密钥为**全局配置**，不挂在 node 上。
- 节点版本历史**只增不减**；回退 = 写新版本，不删旧版本。
- 合并**不销毁子树**：只往父节点加 `merged-conclusion` 段 + 记录。
- 核心数据正确性逻辑（上下文组装、合并、版本、路由收敛）必须与真实 AI **解耦测试**（mock provider）。
- 测试框架：Vitest。前端交互测试用 @testing-library/react。
- 每个任务遵循 TDD：先写失败测试 → 验证失败 → 最小实现 → 验证通过 → 提交。

## 阶段总览

- **阶段 A｜工程脚手架**（Task 1-3）：monorepo、共享类型包、后端/前端骨架。
- **阶段 B｜数据层**（Task 4-9）：SQLite schema、迁移、trees/nodes/annotations/context_segments/node_versions/merges 各仓储。
- **阶段 C｜上下文引擎**（Task 10-12）：段组装策略（灵魂）、版本解析、seed 构造。
- **阶段 D｜Provider 与流式**（Task 13-15）：Provider 抽象、Codex 实现、mock provider、SSE 流。
- **阶段 E｜HTTP API**（Task 16-22）：树/节点/批注/分叉/作答(SSE)/合并/版本 端点。
- **阶段 F｜并行路由与合并**（Task 23-26）：置信度收敛纯逻辑、路由判定服务、迁移改挂、合并回填。
- **阶段 G｜前端基础**（Task 27-30）：API client、状态管理、三栏布局壳、树导航、面包屑。
- **阶段 H｜前端文档与批注**（Task 31-35）：只读文档渲染、批注高亮、批注气泡、子文档 tabs、主文档编排。
- **阶段 I｜前端交互整合与设置**（Task 36-41）：对话框并行路由、路由收敛 UI/迁移、合并 UI、版本/回收站、应用引导、Provider 设置端点。

---

## 阶段 A｜工程脚手架

### Task 1: pnpm workspace 与 shared 类型包

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/types.test.ts`

**Interfaces:**
- Produces: 全栈共享类型。核心枚举与接口，后续所有任务引用：
  - `NodeStatus = 'draft' | 'streaming' | 'complete' | 'error'`
  - `AnnotationKind = 'selection' | 'whole'`
  - `SegmentType = 'ancestor-full' | 'ancestor-summary' | 'annotation-seed' | 'merged-conclusion'`
  - `ChangeKind = 'edit' | 'merge' | 'regenerate'`
  - `RouteTarget = 'main-continuation' | 'bound-subdoc' | 'new-branch'`
  - 接口 `TreeRow, NodeRow, AnnotationRow, ContextSegmentRow, NodeVersionRow, MergeRow`（字段与 spec §3 一致）

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/types.test.ts
import { describe, it, expect } from 'vitest'
import { NODE_STATUSES, SEGMENT_TYPES, ROUTE_TARGETS } from './index'

describe('shared type constants', () => {
  it('exposes all node statuses', () => {
    expect(NODE_STATUSES).toEqual(['draft', 'streaming', 'complete', 'error'])
  })
  it('exposes all segment types', () => {
    expect(SEGMENT_TYPES).toEqual([
      'ancestor-full', 'ancestor-summary', 'annotation-seed', 'merged-conclusion',
    ])
  })
  it('exposes all route targets', () => {
    expect(ROUTE_TARGETS).toEqual(['main-continuation', 'bound-subdoc', 'new-branch'])
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/shared test`
Expected: FAIL（模块/导出不存在）

- [ ] **Step 3: 最小实现**

`package.json`（根）:
```json
{
  "name": "vibe-docing",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

`packages/shared/package.json`:
```json
{
  "name": "@vibe/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/shared/src/types.ts`:
```ts
export const NODE_STATUSES = ['draft', 'streaming', 'complete', 'error'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

export const ANNOTATION_KINDS = ['selection', 'whole'] as const
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number]

export const SEGMENT_TYPES = [
  'ancestor-full', 'ancestor-summary', 'annotation-seed', 'merged-conclusion',
] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

export const CHANGE_KINDS = ['edit', 'merge', 'regenerate'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

export const ROUTE_TARGETS = ['main-continuation', 'bound-subdoc', 'new-branch'] as const
export type RouteTarget = (typeof ROUTE_TARGETS)[number]

export interface TreeRow {
  id: string; title: string
  root_node_id: string | null
  created_at: string; updated_at: string
}
export interface NodeRow {
  id: string; tree_id: string; parent_id: string | null
  sort_order: number
  user_input: string | null
  ai_response: string | null // ProseMirror JSON (stringified)
  status: NodeStatus
  is_deleted: 0 | 1
  model_override: string | null
  created_at: string; updated_at: string
}
export interface AnnotationRow {
  id: string; node_id: string; kind: AnnotationKind
  anchor_from: number | null; anchor_to: number | null
  quoted_text: string | null; note: string | null
  child_node_id: string | null; created_at: string
}
export interface ContextSegmentRow {
  id: string; node_id: string; seq: number
  type: SegmentType
  ref_node_id: string | null
  ref_version_no: number | null
  content: string | null
}
export interface NodeVersionRow {
  id: string; node_id: string; version_no: number
  user_input: string | null; ai_response: string | null
  change_kind: ChangeKind; created_at: string
}
export interface MergeRow {
  id: string; source_node_id: string; target_node_id: string
  conclusion: string; landing_segment_id: string; created_at: string
}
```

`packages/shared/src/index.ts`:
```ts
export * from './types'
```

- [ ] **Step 4: 验证通过**

Run: `pnpm install && pnpm --filter @vibe/shared test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/shared pnpm-lock.yaml
git commit -m "chore: pnpm workspace + shared types package"
```

---

### Task 2: 后端骨架（Fastify + 健康检查）

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**
- Consumes: `@vibe/shared`
- Produces: `buildApp(): FastifyInstance` 工厂（测试可 inject，不监听端口）；`GET /health → { ok: true }`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/app.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from './app'

describe('app', () => {
  it('responds to health check', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test`
Expected: FAIL（buildApp 不存在）

- [ ] **Step 3: 最小实现**

`packages/server/package.json`:
```json
{
  "name": "@vibe/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vibe/shared": "workspace:*",
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": { "tsx": "^4.0.0", "@types/better-sqlite3": "^7.6.0" }
}
```

`packages/server/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(cors, { origin: true })
  app.get('/health', async () => ({ ok: true }))
  return app
}
```

`packages/server/src/index.ts`:
```ts
import { buildApp } from './app'

const app = buildApp()
const port = Number(process.env.PORT ?? 4000)
app.listen({ port }).then(() => console.log(`server on :${port}`))
```

- [ ] **Step 4: 验证通过**

Run: `pnpm install && pnpm --filter @vibe/server test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server pnpm-lock.yaml
git commit -m "feat: fastify server skeleton with health check"
```

---

### Task 3: 前端骨架（Vite + React）

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Test: `packages/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `@vibe/shared`
- Produces: `<App/>` 渲染标题 "树形对话工作台"；Vitest + jsdom + testing-library 配好

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/App.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('renders title', () => {
    render(<App />)
    expect(screen.getByText('树形对话工作台')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test`
Expected: FAIL（App 不存在）

- [ ] **Step 3: 最小实现**

`packages/web/package.json`:
```json
{
  "name": "@vibe/web",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vibe/shared": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

`packages/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  server: { proxy: { '/api': 'http://localhost:4000' } },
})
```

`packages/web/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src"]
}
```

`packages/web/index.html`:
```html
<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>树形对话工作台</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`packages/web/src/App.tsx`:
```tsx
export function App() {
  return <h1>树形对话工作台</h1>
}
```

`packages/web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: 验证通过**

Run: `pnpm install && pnpm --filter @vibe/web test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web pnpm-lock.yaml
git commit -m "feat: vite react web skeleton"
```

---

## 阶段 B｜数据层

### Task 4: SQLite 连接与 schema 迁移

**Files:**
- Create: `packages/server/src/db/schema.sql`
- Create: `packages/server/src/db/connection.ts`
- Test: `packages/server/src/db/connection.test.ts`

**Interfaces:**
- Consumes: better-sqlite3
- Produces:
  - `openDb(path: string): Database` — 打开连接、开启外键、执行 schema（幂等 `CREATE TABLE IF NOT EXISTS`）
  - `openMemoryDb(): Database` — `openDb(':memory:')`，测试用
  - schema 建六张表 + `settings`，字段与 spec §3 完全一致

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/db/connection.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from './connection'

describe('db schema', () => {
  it('creates all tables', () => {
    const db = openMemoryDb()
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of [
      'trees', 'nodes', 'annotations', 'context_segments',
      'node_versions', 'merges', 'settings',
    ]) {
      expect(names).toContain(t)
    }
  })

  it('enforces foreign keys', () => {
    const db = openMemoryDb()
    expect(() =>
      db.prepare(
        "INSERT INTO nodes (id, tree_id, sort_order, status, is_deleted) VALUES ('n1','missing',0,'draft',0)",
      ).run(),
    ).toThrow()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/db/connection.test.ts`
Expected: FAIL（openMemoryDb 不存在）

- [ ] **Step 3: 最小实现**

`packages/server/src/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS trees (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root_node_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id),
  parent_id TEXT REFERENCES nodes(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  user_input TEXT,
  ai_response TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  model_override TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_tree ON nodes(tree_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  kind TEXT NOT NULL,
  anchor_from INTEGER,
  anchor_to INTEGER,
  quoted_text TEXT,
  note TEXT,
  child_node_id TEXT REFERENCES nodes(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_node ON annotations(node_id);
CREATE TABLE IF NOT EXISTS context_segments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  ref_node_id TEXT REFERENCES nodes(id),
  ref_version_no INTEGER,
  content TEXT
);
CREATE INDEX IF NOT EXISTS idx_segments_node ON context_segments(node_id);
CREATE TABLE IF NOT EXISTS node_versions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  version_no INTEGER NOT NULL,
  user_input TEXT,
  ai_response TEXT,
  change_kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_node ON node_versions(node_id);
CREATE TABLE IF NOT EXISTS merges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL REFERENCES nodes(id),
  target_node_id TEXT NOT NULL REFERENCES nodes(id),
  conclusion TEXT NOT NULL,
  landing_segment_id TEXT NOT NULL REFERENCES context_segments(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`packages/server/src/db/connection.ts`:
```ts
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export type Db = Database.Database

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
  db.exec(schema)
  return db
}

export function openMemoryDb(): Db {
  return openDb(':memory:')
}
```

> 注意：Vitest 需能读到 `schema.sql`。在 `packages/server/vitest.config.ts` 或测试运行时确保工作目录含该文件。若用 `tsx`/vite 转译导致 `import.meta.url` 指向 src，此实现直接从 src 读取，测试可用。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/db/connection.test.ts`
Expected: PASS（两个用例都过）

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/db
git commit -m "feat: sqlite schema and connection"
```

---

### Task 5: ID 与时钟工具

**Files:**
- Create: `packages/server/src/util/ids.ts`
- Create: `packages/server/src/util/clock.ts`
- Test: `packages/server/src/util/ids.test.ts`

**Interfaces:**
- Produces:
  - `newId(): string` — 基于 nanoid，21 位
  - `Clock` 接口 `{ now(): string }`；`systemClock: Clock`（返回 ISO 字符串）；`fixedClock(iso: string): Clock`（测试用，可注入，避免 spec 中"时间依赖"问题）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/util/ids.test.ts
import { describe, it, expect } from 'vitest'
import { newId } from './ids'
import { fixedClock } from './clock'

describe('ids & clock', () => {
  it('generates unique ids', () => {
    const a = newId(); const b = newId()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(12)
  })
  it('fixed clock returns fixed time', () => {
    const c = fixedClock('2026-08-05T00:00:00.000Z')
    expect(c.now()).toBe('2026-08-05T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/util/ids.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/util/ids.ts`:
```ts
import { nanoid } from 'nanoid'
export function newId(): string {
  return nanoid()
}
```

`packages/server/src/util/clock.ts`:
```ts
export interface Clock {
  now(): string
}
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
}
export function fixedClock(iso: string): Clock {
  return { now: () => iso }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/util/ids.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/util
git commit -m "feat: id and clock utilities"
```

---

### Task 6: TreeRepo（建树 + 根节点）

**Files:**
- Create: `packages/server/src/repo/tree-repo.ts`
- Test: `packages/server/src/repo/tree-repo.test.ts`

**Interfaces:**
- Consumes: `Db`, `newId`, `Clock`, `TreeRow`, `NodeRow`
- Produces:
  - `createTreeRepo(db: Db, clock: Clock)` 返回 `{ create, get, list }`
  - `create(title: string): { tree: TreeRow; rootNode: NodeRow }` — 建 tree + 一个空根 node（status `complete`, parent_id null），并回填 `trees.root_node_id`
  - `get(id): TreeRow | undefined`
  - `list(): TreeRow[]`（按 updated_at desc）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/repo/tree-repo.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from './tree-repo'

describe('TreeRepo', () => {
  it('creates a tree with a root node', () => {
    const db = openMemoryDb()
    const repo = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))
    const { tree, rootNode } = repo.create('缓存设计')
    expect(tree.title).toBe('缓存设计')
    expect(tree.root_node_id).toBe(rootNode.id)
    expect(rootNode.parent_id).toBeNull()
    expect(rootNode.tree_id).toBe(tree.id)
    expect(repo.get(tree.id)?.root_node_id).toBe(rootNode.id)
  })
  it('lists trees', () => {
    const db = openMemoryDb()
    const repo = createTreeRepo(db, fixedClock('2026-08-05T00:00:00.000Z'))
    repo.create('a'); repo.create('b')
    expect(repo.list().length).toBe(2)
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/repo/tree-repo.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/repo/tree-repo.ts`:
```ts
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'
import type { TreeRow, NodeRow } from '@vibe/shared'

export function createTreeRepo(db: Db, clock: Clock) {
  function create(title: string): { tree: TreeRow; rootNode: NodeRow } {
    const now = clock.now()
    const treeId = newId()
    const rootId = newId()
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO trees (id,title,root_node_id,created_at,updated_at) VALUES (?,?,?,?,?)',
      ).run(treeId, title, rootId, now, now)
      db.prepare(
        `INSERT INTO nodes (id,tree_id,parent_id,sort_order,user_input,ai_response,status,is_deleted,model_override,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(rootId, treeId, null, 0, null, null, 'complete', 0, null, now, now)
    })
    tx()
    return { tree: get(treeId)!, rootNode: getNode(rootId)! }
  }
  function get(id: string): TreeRow | undefined {
    return db.prepare('SELECT * FROM trees WHERE id=?').get(id) as TreeRow | undefined
  }
  function getNode(id: string): NodeRow | undefined {
    return db.prepare('SELECT * FROM nodes WHERE id=?').get(id) as NodeRow | undefined
  }
  function list(): TreeRow[] {
    return db.prepare('SELECT * FROM trees ORDER BY updated_at DESC').all() as TreeRow[]
  }
  return { create, get, list }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/repo/tree-repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/repo/tree-repo.ts packages/server/src/repo/tree-repo.test.ts
git commit -m "feat: tree repo with root node creation"
```

---

### Task 7: NodeRepo（增删改查 + 软删除 + 子节点）

**Files:**
- Create: `packages/server/src/repo/node-repo.ts`
- Test: `packages/server/src/repo/node-repo.test.ts`

**Interfaces:**
- Consumes: `Db`, `Clock`, `newId`, `NodeRow`, `NodeStatus`
- Produces: `createNodeRepo(db, clock)` 返回：
  - `create(input: { treeId: string; parentId: string | null; userInput?: string | null; status?: NodeStatus }): NodeRow` — sort_order 自动取同父下最大+1
  - `get(id): NodeRow | undefined`
  - `getChildren(parentId: string): NodeRow[]` — 排除 is_deleted，按 sort_order
  - `getPathToRoot(nodeId: string): NodeRow[]` — 从根到该节点（含）的有序数组
  - `updateContent(id, patch: { userInput?; aiResponse?; status? }): NodeRow`
  - `softDelete(id): void` — 该节点及其整棵子树全部 is_deleted=1
  - `restore(id): void` — 该节点及子树 is_deleted=0
  - `listDeleted(treeId): NodeRow[]`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/repo/node-repo.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from './tree-repo'
import { createNodeRepo } from './node-repo'

function setup() {
  const db = openMemoryDb()
  const clock = fixedClock('2026-08-05T00:00:00.000Z')
  const trees = createTreeRepo(db, clock)
  const nodes = createNodeRepo(db, clock)
  const { tree, rootNode } = trees.create('t')
  return { db, trees, nodes, tree, rootNode }
}

describe('NodeRepo', () => {
  it('creates child with incrementing sort_order', () => {
    const { nodes, tree, rootNode } = setup()
    const a = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const b = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    expect(a.sort_order).toBe(0)
    expect(b.sort_order).toBe(1)
    expect(nodes.getChildren(rootNode.id).map((n) => n.id)).toEqual([a.id, b.id])
  })
  it('returns path from root to node', () => {
    const { nodes, tree, rootNode } = setup()
    const a = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const b = nodes.create({ treeId: tree.id, parentId: a.id })
    expect(nodes.getPathToRoot(b.id).map((n) => n.id)).toEqual([rootNode.id, a.id, b.id])
  })
  it('soft deletes node and its subtree', () => {
    const { nodes, tree, rootNode } = setup()
    const a = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const b = nodes.create({ treeId: tree.id, parentId: a.id })
    nodes.softDelete(a.id)
    expect(nodes.get(a.id)?.is_deleted).toBe(1)
    expect(nodes.get(b.id)?.is_deleted).toBe(1)
    expect(nodes.getChildren(rootNode.id)).toHaveLength(0)
    expect(nodes.listDeleted(tree.id).map((n) => n.id).sort()).toEqual([a.id, b.id].sort())
  })
  it('restores node and subtree', () => {
    const { nodes, tree, rootNode } = setup()
    const a = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const b = nodes.create({ treeId: tree.id, parentId: a.id })
    nodes.softDelete(a.id); nodes.restore(a.id)
    expect(nodes.get(a.id)?.is_deleted).toBe(0)
    expect(nodes.get(b.id)?.is_deleted).toBe(0)
  })
  it('updates content', () => {
    const { nodes, tree, rootNode } = setup()
    const a = nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: 'q' })
    const u = nodes.updateContent(a.id, { aiResponse: '{"x":1}', status: 'complete' })
    expect(u.ai_response).toBe('{"x":1}')
    expect(u.status).toBe('complete')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/repo/node-repo.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/repo/node-repo.ts`:
```ts
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'
import type { NodeRow, NodeStatus } from '@vibe/shared'

export function createNodeRepo(db: Db, clock: Clock) {
  function get(id: string): NodeRow | undefined {
    return db.prepare('SELECT * FROM nodes WHERE id=?').get(id) as NodeRow | undefined
  }
  function create(input: {
    treeId: string; parentId: string | null
    userInput?: string | null; status?: NodeStatus
  }): NodeRow {
    const now = clock.now()
    const id = newId()
    const row = db.prepare(
      'SELECT COALESCE(MAX(sort_order)+1,0) AS n FROM nodes WHERE parent_id IS ?',
    ).get(input.parentId) as { n: number }
    db.prepare(
      `INSERT INTO nodes (id,tree_id,parent_id,sort_order,user_input,ai_response,status,is_deleted,model_override,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, input.treeId, input.parentId, row.n, input.userInput ?? null, null,
      input.status ?? 'draft', 0, null, now, now)
    return get(id)!
  }
  function getChildren(parentId: string): NodeRow[] {
    return db.prepare(
      'SELECT * FROM nodes WHERE parent_id=? AND is_deleted=0 ORDER BY sort_order',
    ).all(parentId) as NodeRow[]
  }
  function getPathToRoot(nodeId: string): NodeRow[] {
    const path: NodeRow[] = []
    let cur = get(nodeId)
    while (cur) {
      path.unshift(cur)
      cur = cur.parent_id ? get(cur.parent_id) : undefined
    }
    return path
  }
  function updateContent(
    id: string,
    patch: { userInput?: string | null; aiResponse?: string | null; status?: NodeStatus },
  ): NodeRow {
    const cur = get(id)!
    const now = clock.now()
    db.prepare(
      'UPDATE nodes SET user_input=?, ai_response=?, status=?, updated_at=? WHERE id=?',
    ).run(
      patch.userInput !== undefined ? patch.userInput : cur.user_input,
      patch.aiResponse !== undefined ? patch.aiResponse : cur.ai_response,
      patch.status ?? cur.status, now, id,
    )
    return get(id)!
  }
  function collectSubtree(id: string): string[] {
    const ids = [id]
    const stack = [id]
    while (stack.length) {
      const p = stack.pop()!
      const kids = db.prepare('SELECT id FROM nodes WHERE parent_id=?').all(p) as { id: string }[]
      for (const k of kids) { ids.push(k.id); stack.push(k.id) }
    }
    return ids
  }
  function setDeleted(id: string, flag: 0 | 1): void {
    const ids = collectSubtree(id)
    const stmt = db.prepare('UPDATE nodes SET is_deleted=? WHERE id=?')
    const tx = db.transaction(() => { for (const i of ids) stmt.run(flag, i) })
    tx()
  }
  function softDelete(id: string): void { setDeleted(id, 1) }
  function restore(id: string): void { setDeleted(id, 0) }
  function listDeleted(treeId: string): NodeRow[] {
    return db.prepare(
      'SELECT * FROM nodes WHERE tree_id=? AND is_deleted=1 ORDER BY created_at',
    ).all(treeId) as NodeRow[]
  }
  return { get, create, getChildren, getPathToRoot, updateContent, softDelete, restore, listDeleted }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/repo/node-repo.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/repo/node-repo.ts packages/server/src/repo/node-repo.test.ts
git commit -m "feat: node repo with subtree soft-delete and path"
```

---

### Task 8: AnnotationRepo 与 SegmentRepo

**Files:**
- Create: `packages/server/src/repo/annotation-repo.ts`
- Create: `packages/server/src/repo/segment-repo.ts`
- Test: `packages/server/src/repo/annotation-repo.test.ts`
- Test: `packages/server/src/repo/segment-repo.test.ts`

**Interfaces:**
- Produces:
  - `createAnnotationRepo(db, clock)`：`create(input: { nodeId; kind; anchorFrom?; anchorTo?; quotedText?; note? }): AnnotationRow`；`listByNode(nodeId): AnnotationRow[]`；`linkChild(annotationId, childNodeId): void`；`get(id)`
  - `createSegmentRepo(db)`：`add(input: { nodeId; seq; type; refNodeId?; refVersionNo?; content? }): ContextSegmentRow`；`listByNode(nodeId): ContextSegmentRow[]`（按 seq）；`nextSeq(nodeId): number`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/repo/annotation-repo.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from './tree-repo'
import { createNodeRepo } from './node-repo'
import { createAnnotationRepo } from './annotation-repo'

describe('AnnotationRepo', () => {
  it('creates selection annotation and links child', () => {
    const db = openMemoryDb()
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const anns = createAnnotationRepo(db, clock)
    const ann = anns.create({
      nodeId: rootNode.id, kind: 'selection',
      anchorFrom: 5, anchorTo: 12, quotedText: 'Redis', note: '深入这个',
    })
    expect(ann.kind).toBe('selection')
    expect(ann.quoted_text).toBe('Redis')
    const child = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    anns.linkChild(ann.id, child.id)
    expect(anns.get(ann.id)?.child_node_id).toBe(child.id)
    expect(anns.listByNode(rootNode.id)).toHaveLength(1)
  })
})
```

```ts
// packages/server/src/repo/segment-repo.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from './tree-repo'
import { createNodeRepo } from './node-repo'
import { createSegmentRepo } from './segment-repo'

describe('SegmentRepo', () => {
  it('adds segments and lists ordered by seq', () => {
    const db = openMemoryDb()
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const child = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const seg = createSegmentRepo(db)
    seg.add({ nodeId: child.id, seq: 0, type: 'ancestor-full', refNodeId: rootNode.id })
    seg.add({ nodeId: child.id, seq: 1, type: 'annotation-seed', content: 'seed text' })
    const list = seg.listByNode(child.id)
    expect(list.map((s) => s.type)).toEqual(['ancestor-full', 'annotation-seed'])
    expect(seg.nextSeq(child.id)).toBe(2)
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/repo/annotation-repo.test.ts src/repo/segment-repo.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/repo/annotation-repo.ts`:
```ts
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'
import type { AnnotationRow, AnnotationKind } from '@vibe/shared'

export function createAnnotationRepo(db: Db, clock: Clock) {
  function get(id: string): AnnotationRow | undefined {
    return db.prepare('SELECT * FROM annotations WHERE id=?').get(id) as AnnotationRow | undefined
  }
  function create(input: {
    nodeId: string; kind: AnnotationKind
    anchorFrom?: number | null; anchorTo?: number | null
    quotedText?: string | null; note?: string | null
  }): AnnotationRow {
    const id = newId()
    db.prepare(
      `INSERT INTO annotations (id,node_id,kind,anchor_from,anchor_to,quoted_text,note,child_node_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, input.nodeId, input.kind, input.anchorFrom ?? null, input.anchorTo ?? null,
      input.quotedText ?? null, input.note ?? null, null, clock.now())
    return get(id)!
  }
  function linkChild(annotationId: string, childNodeId: string): void {
    db.prepare('UPDATE annotations SET child_node_id=? WHERE id=?').run(childNodeId, annotationId)
  }
  function listByNode(nodeId: string): AnnotationRow[] {
    return db.prepare('SELECT * FROM annotations WHERE node_id=? ORDER BY created_at')
      .all(nodeId) as AnnotationRow[]
  }
  return { get, create, linkChild, listByNode }
}
```

`packages/server/src/repo/segment-repo.ts`:
```ts
import type { Db } from '../db/connection'
import { newId } from '../util/ids'
import type { ContextSegmentRow, SegmentType } from '@vibe/shared'

export function createSegmentRepo(db: Db) {
  function add(input: {
    nodeId: string; seq: number; type: SegmentType
    refNodeId?: string | null; refVersionNo?: number | null; content?: string | null
  }): ContextSegmentRow {
    const id = newId()
    db.prepare(
      `INSERT INTO context_segments (id,node_id,seq,type,ref_node_id,ref_version_no,content)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, input.nodeId, input.seq, input.type,
      input.refNodeId ?? null, input.refVersionNo ?? null, input.content ?? null)
    return db.prepare('SELECT * FROM context_segments WHERE id=?').get(id) as ContextSegmentRow
  }
  function listByNode(nodeId: string): ContextSegmentRow[] {
    return db.prepare('SELECT * FROM context_segments WHERE node_id=? ORDER BY seq')
      .all(nodeId) as ContextSegmentRow[]
  }
  function nextSeq(nodeId: string): number {
    const r = db.prepare('SELECT COALESCE(MAX(seq)+1,0) AS n FROM context_segments WHERE node_id=?')
      .get(nodeId) as { n: number }
    return r.n
  }
  return { add, listByNode, nextSeq }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/repo/annotation-repo.test.ts src/repo/segment-repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/repo/annotation-repo.ts packages/server/src/repo/segment-repo.ts packages/server/src/repo/annotation-repo.test.ts packages/server/src/repo/segment-repo.test.ts
git commit -m "feat: annotation and segment repos"
```

---

### Task 9: VersionRepo 与 MergeRepo

**Files:**
- Create: `packages/server/src/repo/version-repo.ts`
- Create: `packages/server/src/repo/merge-repo.ts`
- Test: `packages/server/src/repo/version-repo.test.ts`

**Interfaces:**
- Produces:
  - `createVersionRepo(db, clock)`：`snapshot(input: { nodeId; userInput; aiResponse; changeKind }): NodeVersionRow`（version_no 自增，从 1 起）；`listByNode(nodeId): NodeVersionRow[]`（按 version_no）；`get(nodeId, versionNo): NodeVersionRow | undefined`
  - `createMergeRepo(db, clock)`：`record(input: { sourceNodeId; targetNodeId; conclusion; landingSegmentId }): MergeRow`；`listByTarget(targetNodeId): MergeRow[]`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/repo/version-repo.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from './tree-repo'
import { createVersionRepo } from './version-repo'
import { createMergeRepo } from './merge-repo'
import { createSegmentRepo } from './segment-repo'
import { createNodeRepo } from './node-repo'

describe('VersionRepo & MergeRepo', () => {
  it('snapshots with incrementing version_no', () => {
    const db = openMemoryDb()
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { rootNode } = createTreeRepo(db, clock).create('t')
    const versions = createVersionRepo(db, clock)
    const v1 = versions.snapshot({ nodeId: rootNode.id, userInput: 'q', aiResponse: 'a', changeKind: 'edit' })
    const v2 = versions.snapshot({ nodeId: rootNode.id, userInput: 'q', aiResponse: 'b', changeKind: 'edit' })
    expect(v1.version_no).toBe(1)
    expect(v2.version_no).toBe(2)
    expect(versions.get(rootNode.id, 1)?.ai_response).toBe('a')
    expect(versions.listByNode(rootNode.id)).toHaveLength(2)
  })
  it('records a merge', () => {
    const db = openMemoryDb()
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const child = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const seg = createSegmentRepo(db)
      .add({ nodeId: rootNode.id, seq: 0, type: 'merged-conclusion', content: 'X' })
    const merges = createMergeRepo(db, clock)
    const m = merges.record({
      sourceNodeId: child.id, targetNodeId: rootNode.id,
      conclusion: 'X', landingSegmentId: seg.id,
    })
    expect(m.target_node_id).toBe(rootNode.id)
    expect(merges.listByTarget(rootNode.id)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/repo/version-repo.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/repo/version-repo.ts`:
```ts
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'
import type { NodeVersionRow, ChangeKind } from '@vibe/shared'

export function createVersionRepo(db: Db, clock: Clock) {
  function snapshot(input: {
    nodeId: string; userInput: string | null; aiResponse: string | null; changeKind: ChangeKind
  }): NodeVersionRow {
    const id = newId()
    const r = db.prepare(
      'SELECT COALESCE(MAX(version_no)+1,1) AS n FROM node_versions WHERE node_id=?',
    ).get(input.nodeId) as { n: number }
    db.prepare(
      `INSERT INTO node_versions (id,node_id,version_no,user_input,ai_response,change_kind,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, input.nodeId, r.n, input.userInput, input.aiResponse, input.changeKind, clock.now())
    return db.prepare('SELECT * FROM node_versions WHERE id=?').get(id) as NodeVersionRow
  }
  function listByNode(nodeId: string): NodeVersionRow[] {
    return db.prepare('SELECT * FROM node_versions WHERE node_id=? ORDER BY version_no')
      .all(nodeId) as NodeVersionRow[]
  }
  function get(nodeId: string, versionNo: number): NodeVersionRow | undefined {
    return db.prepare('SELECT * FROM node_versions WHERE node_id=? AND version_no=?')
      .get(nodeId, versionNo) as NodeVersionRow | undefined
  }
  return { snapshot, listByNode, get }
}
```

`packages/server/src/repo/merge-repo.ts`:
```ts
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'
import type { MergeRow } from '@vibe/shared'

export function createMergeRepo(db: Db, clock: Clock) {
  function record(input: {
    sourceNodeId: string; targetNodeId: string; conclusion: string; landingSegmentId: string
  }): MergeRow {
    const id = newId()
    db.prepare(
      `INSERT INTO merges (id,source_node_id,target_node_id,conclusion,landing_segment_id,created_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(id, input.sourceNodeId, input.targetNodeId, input.conclusion, input.landingSegmentId, clock.now())
    return db.prepare('SELECT * FROM merges WHERE id=?').get(id) as MergeRow
  }
  function listByTarget(targetNodeId: string): MergeRow[] {
    return db.prepare('SELECT * FROM merges WHERE target_node_id=? ORDER BY created_at')
      .all(targetNodeId) as MergeRow[]
  }
  return { record, listByTarget }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/repo/version-repo.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/repo/version-repo.ts packages/server/src/repo/merge-repo.ts packages/server/src/repo/version-repo.test.ts
git commit -m "feat: version and merge repos"
```

---

## 阶段 C｜上下文引擎（灵魂）

### Task 10: 分叉时的 seed 段构造（buildBranchSegments）

**Files:**
- Create: `packages/server/src/context/build-branch-segments.ts`
- Test: `packages/server/src/context/build-branch-segments.test.ts`

**Interfaces:**
- Consumes: `NodeRepo`（`getPathToRoot`）, `SegmentRepo`
- Produces:
  - `buildBranchSegments(deps: { nodes; segments }, input: { childNodeId; parentNodeId; seedText: string }): void`
  - 语义：为新子节点写入上下文段——父路径（根→父）每个节点一个 `ancestor-full` 段（`refVersionNo` 留 null=跟随最新），seq 递增；最后追加一个 `annotation-seed` 段（content=seedText）。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/context/build-branch-segments.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from '../repo/tree-repo'
import { createNodeRepo } from '../repo/node-repo'
import { createSegmentRepo } from '../repo/segment-repo'
import { buildBranchSegments } from './build-branch-segments'

describe('buildBranchSegments', () => {
  it('writes ancestor-full segments for root->parent path plus a seed', () => {
    const db = openMemoryDb()
    const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const segments = createSegmentRepo(db)
    const parent = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    const child = nodes.create({ treeId: tree.id, parentId: parent.id })

    buildBranchSegments({ nodes, segments }, {
      childNodeId: child.id, parentNodeId: parent.id, seedText: 'Redis 深入',
    })

    const segs = segments.listByNode(child.id)
    expect(segs.map((s) => s.type)).toEqual(['ancestor-full', 'ancestor-full', 'annotation-seed'])
    expect(segs[0].ref_node_id).toBe(rootNode.id)
    expect(segs[1].ref_node_id).toBe(parent.id)
    expect(segs[0].ref_version_no).toBeNull()
    expect(segs[2].content).toBe('Redis 深入')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/context/build-branch-segments.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/context/build-branch-segments.ts`:
```ts
import type { createNodeRepo } from '../repo/node-repo'
import type { createSegmentRepo } from '../repo/segment-repo'

type NodeRepo = ReturnType<typeof createNodeRepo>
type SegmentRepo = ReturnType<typeof createSegmentRepo>

export function buildBranchSegments(
  deps: { nodes: NodeRepo; segments: SegmentRepo },
  input: { childNodeId: string; parentNodeId: string; seedText: string },
): void {
  const path = deps.nodes.getPathToRoot(input.parentNodeId) // 根→父（含父）
  let seq = 0
  for (const anc of path) {
    deps.segments.add({
      nodeId: input.childNodeId, seq: seq++, type: 'ancestor-full',
      refNodeId: anc.id, refVersionNo: null,
    })
  }
  deps.segments.add({
    nodeId: input.childNodeId, seq: seq++, type: 'annotation-seed',
    content: input.seedText,
  })
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/context/build-branch-segments.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/context/build-branch-segments.ts packages/server/src/context/build-branch-segments.test.ts
git commit -m "feat: build branch context segments on fork"
```

---

### Task 11: 段内容解析（resolveSegmentContent + 版本跟随/锁定）

**Files:**
- Create: `packages/server/src/context/resolve-segment.ts`
- Test: `packages/server/src/context/resolve-segment.test.ts`

**Interfaces:**
- Consumes: `NodeRepo`, `VersionRepo`, `ContextSegmentRow`
- Produces:
  - `resolveSegmentContent(deps: { nodes; versions }, seg: ContextSegmentRow): { userInput: string | null; aiResponse: string | null } | { text: string }`
  - 语义：
    - `ancestor-full`：`ref_version_no` 为 null → 取该祖先 node **当前** user_input/ai_response；非 null → 从 node_versions 取该版本快照。返回 `{ userInput, aiResponse }`。
    - `annotation-seed` / `merged-conclusion` / `ancestor-summary`：返回 `{ text: seg.content ?? '' }`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/context/resolve-segment.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from '../repo/tree-repo'
import { createNodeRepo } from '../repo/node-repo'
import { createVersionRepo } from '../repo/version-repo'
import { createSegmentRepo } from '../repo/segment-repo'
import { resolveSegmentContent } from './resolve-segment'

describe('resolveSegmentContent', () => {
  it('ancestor-full with null version follows latest node content', () => {
    const db = openMemoryDb(); const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock); const versions = createVersionRepo(db, clock)
    nodes.updateContent(rootNode.id, { userInput: 'Q', aiResponse: 'A-latest', status: 'complete' })
    const seg = createSegmentRepo(db).add({
      nodeId: 'x', seq: 0, type: 'ancestor-full', refNodeId: rootNode.id, refVersionNo: null,
    })
    const r = resolveSegmentContent({ nodes, versions }, seg) as any
    expect(r.aiResponse).toBe('A-latest')
  })
  it('ancestor-full with locked version reads snapshot', () => {
    const db = openMemoryDb(); const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock); const versions = createVersionRepo(db, clock)
    versions.snapshot({ nodeId: rootNode.id, userInput: 'Q', aiResponse: 'A-v1', changeKind: 'edit' })
    nodes.updateContent(rootNode.id, { aiResponse: 'A-latest', status: 'complete' })
    const seg = createSegmentRepo(db).add({
      nodeId: 'x', seq: 0, type: 'ancestor-full', refNodeId: rootNode.id, refVersionNo: 1,
    })
    const r = resolveSegmentContent({ nodes, versions }, seg) as any
    expect(r.aiResponse).toBe('A-v1')
  })
  it('seed segment returns text', () => {
    const db = openMemoryDb(); const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const nodes = createNodeRepo(db, clock); const versions = createVersionRepo(db, clock)
    const seg = createSegmentRepo(db).add({
      nodeId: 'x', seq: 0, type: 'annotation-seed', content: 'seed',
    })
    const r = resolveSegmentContent({ nodes, versions }, seg) as any
    expect(r.text).toBe('seed')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/context/resolve-segment.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/context/resolve-segment.ts`:
```ts
import type { createNodeRepo } from '../repo/node-repo'
import type { createVersionRepo } from '../repo/version-repo'
import type { ContextSegmentRow } from '@vibe/shared'

type NodeRepo = ReturnType<typeof createNodeRepo>
type VersionRepo = ReturnType<typeof createVersionRepo>

export type ResolvedSegment =
  | { kind: 'ancestor'; userInput: string | null; aiResponse: string | null }
  | { kind: 'text'; text: string }

export function resolveSegmentContent(
  deps: { nodes: NodeRepo; versions: VersionRepo },
  seg: ContextSegmentRow,
): ResolvedSegment {
  if (seg.type === 'ancestor-full') {
    if (seg.ref_version_no != null) {
      const v = deps.versions.get(seg.ref_node_id!, seg.ref_version_no)
      return { kind: 'ancestor', userInput: v?.user_input ?? null, aiResponse: v?.ai_response ?? null }
    }
    const n = deps.nodes.get(seg.ref_node_id!)
    return { kind: 'ancestor', userInput: n?.user_input ?? null, aiResponse: n?.ai_response ?? null }
  }
  return { kind: 'text', text: seg.content ?? '' }
}
```

> 为满足测试中直接读 `r.aiResponse` / `r.text`，`ResolvedSegment` 是可辨识联合；测试用 `as any` 读取字段可通过，实际代码按 `kind` 分支处理。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/context/resolve-segment.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/context/resolve-segment.ts packages/server/src/context/resolve-segment.test.ts
git commit -m "feat: resolve segment content with version follow/lock"
```

---

### Task 12: 上下文组装为消息数组（assembleContext）

**Files:**
- Create: `packages/server/src/context/assemble.ts`
- Test: `packages/server/src/context/assemble.test.ts`

**Interfaces:**
- Consumes: `SegmentRepo`, `resolveSegmentContent`, `NodeRepo`, `VersionRepo`
- Produces:
  - 类型 `ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }`（导出，Provider 与后续任务共用）
  - `assembleContext(deps: { nodes; versions; segments }, nodeId: string, currentUserInput: string): ChatMessage[]`
  - 语义（近期唯一策略 = 完整前缀）：按 seq 遍历该节点的段——
    - `ancestor-full`：产出一对 `{role:'user', content:userInput}`（若非空）、`{role:'assistant', content: aiResponseText}`（若非空；aiResponse 是 ProseMirror JSON，用 `prosemirrorToPlainText` 转纯文本）
    - `annotation-seed` / `merged-conclusion` / `ancestor-summary`：产出一条 `{role:'user', content: text}`（前缀标注，如 `[聚焦] ` / `[已并入结论] `）
    - 末尾追加当前这轮 `{role:'user', content: currentUserInput}`
- 依赖工具：`prosemirrorToPlainText(json: string | null): string` 放在 `packages/shared/src/prosemirror.ts` 并从 index 导出（前后端共用）

- [ ] **Step 1: 写失败测试**

先在 shared 加纯文本提取：

```ts
// packages/shared/src/prosemirror.test.ts
import { describe, it, expect } from 'vitest'
import { prosemirrorToPlainText } from './index'

describe('prosemirrorToPlainText', () => {
  it('extracts text from doc json', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'line2' }] },
      ],
    })
    expect(prosemirrorToPlainText(doc)).toBe('Hello world\nline2')
  })
  it('handles null', () => {
    expect(prosemirrorToPlainText(null)).toBe('')
  })
})
```

```ts
// packages/server/src/context/assemble.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from '../repo/tree-repo'
import { createNodeRepo } from '../repo/node-repo'
import { createVersionRepo } from '../repo/version-repo'
import { createSegmentRepo } from '../repo/segment-repo'
import { buildBranchSegments } from './build-branch-segments'
import { assembleContext } from './assemble'

function pmDoc(text: string) {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
}

describe('assembleContext', () => {
  it('produces full-prefix messages from ancestors plus seed plus current input', () => {
    const db = openMemoryDb(); const clock = fixedClock('2026-08-05T00:00:00.000Z')
    const { tree, rootNode } = createTreeRepo(db, clock).create('t')
    const nodes = createNodeRepo(db, clock)
    const versions = createVersionRepo(db, clock)
    const segments = createSegmentRepo(db)
    nodes.updateContent(rootNode.id, { userInput: '设计缓存', aiResponse: pmDoc('用 Redis 或本地内存'), status: 'complete' })
    const child = nodes.create({ treeId: tree.id, parentId: rootNode.id })
    buildBranchSegments({ nodes, segments }, { childNodeId: child.id, parentNodeId: rootNode.id, seedText: 'Redis' })

    const msgs = assembleContext({ nodes, versions, segments }, child.id, '它的持久化怎么配')
    expect(msgs).toEqual([
      { role: 'user', content: '设计缓存' },
      { role: 'assistant', content: '用 Redis 或本地内存' },
      { role: 'user', content: '[聚焦] Redis' },
      { role: 'user', content: '它的持久化怎么配' },
    ])
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/shared test src/prosemirror.test.ts && pnpm --filter @vibe/server test src/context/assemble.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/shared/src/prosemirror.ts`:
```ts
interface PMNode { type?: string; text?: string; content?: PMNode[] }

export function prosemirrorToPlainText(json: string | null): string {
  if (!json) return ''
  let doc: PMNode
  try { doc = JSON.parse(json) as PMNode } catch { return '' }
  const blocks: string[] = []
  function walkBlock(node: PMNode): string {
    let s = ''
    if (node.text) s += node.text
    if (node.content) for (const c of node.content) s += walkBlock(c)
    return s
  }
  for (const block of doc.content ?? []) blocks.push(walkBlock(block))
  return blocks.join('\n')
}
```

在 `packages/shared/src/index.ts` 追加：
```ts
export * from './prosemirror'
```

`packages/server/src/context/assemble.ts`:
```ts
import type { createNodeRepo } from '../repo/node-repo'
import type { createVersionRepo } from '../repo/version-repo'
import type { createSegmentRepo } from '../repo/segment-repo'
import { resolveSegmentContent } from './resolve-segment'
import { prosemirrorToPlainText } from '@vibe/shared'

type NodeRepo = ReturnType<typeof createNodeRepo>
type VersionRepo = ReturnType<typeof createVersionRepo>
type SegmentRepo = ReturnType<typeof createSegmentRepo>

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function assembleContext(
  deps: { nodes: NodeRepo; versions: VersionRepo; segments: SegmentRepo },
  nodeId: string,
  currentUserInput: string,
): ChatMessage[] {
  const msgs: ChatMessage[] = []
  for (const seg of deps.segments.listByNode(nodeId)) {
    const r = resolveSegmentContent({ nodes: deps.nodes, versions: deps.versions }, seg)
    if (r.kind === 'ancestor') {
      if (r.userInput) msgs.push({ role: 'user', content: r.userInput })
      if (r.aiResponse) msgs.push({ role: 'assistant', content: prosemirrorToPlainText(r.aiResponse) })
    } else {
      const prefix = seg.type === 'merged-conclusion' ? '[已并入结论] ' : '[聚焦] '
      msgs.push({ role: 'user', content: prefix + r.text })
    }
  }
  msgs.push({ role: 'user', content: currentUserInput })
  return msgs
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/shared test src/prosemirror.test.ts && pnpm --filter @vibe/server test src/context/assemble.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/prosemirror.ts packages/shared/src/prosemirror.test.ts packages/shared/src/index.ts packages/server/src/context/assemble.ts packages/server/src/context/assemble.test.ts
git commit -m "feat: assemble full-prefix context into chat messages"
```

---

## 阶段 D｜Provider 与流式

### Task 13: Provider 抽象接口 + MockProvider

**Files:**
- Create: `packages/server/src/provider/types.ts`
- Create: `packages/server/src/provider/mock-provider.ts`
- Test: `packages/server/src/provider/mock-provider.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`（从 `../context/assemble` 导出）
- Produces:
  - `interface Provider { stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string>; complete(messages: ChatMessage[]): Promise<string> }`
  - `interface RouteProvider { classify(question: string, outline: RouteOutline): Promise<RouteDecision> }`（类型在 Task 23 定义，此处仅 Provider.stream/complete）
  - `createMockProvider(opts: { chunks?: string[]; failAfter?: number }): Provider` — `stream` 逐块 yield（`failAfter` 触发抛错模拟中断）；`complete` 返回 chunks 拼接

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/provider/mock-provider.test.ts
import { describe, it, expect } from 'vitest'
import { createMockProvider } from './mock-provider'

describe('MockProvider', () => {
  it('streams chunks', async () => {
    const p = createMockProvider({ chunks: ['Hello ', 'world'] })
    const out: string[] = []
    for await (const c of p.stream([{ role: 'user', content: 'hi' }])) out.push(c)
    expect(out).toEqual(['Hello ', 'world'])
  })
  it('complete joins chunks', async () => {
    const p = createMockProvider({ chunks: ['a', 'b'] })
    expect(await p.complete([{ role: 'user', content: 'x' }])).toBe('ab')
  })
  it('fails after N chunks', async () => {
    const p = createMockProvider({ chunks: ['a', 'b', 'c'], failAfter: 2 })
    const out: string[] = []
    await expect(async () => {
      for await (const c of p.stream([{ role: 'user', content: 'x' }])) out.push(c)
    }).rejects.toThrow()
    expect(out).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/provider/mock-provider.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/provider/types.ts`:
```ts
import type { ChatMessage } from '../context/assemble'

export interface Provider {
  stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string>
  complete(messages: ChatMessage[]): Promise<string>
}
```

`packages/server/src/provider/mock-provider.ts`:
```ts
import type { Provider } from './types'
import type { ChatMessage } from '../context/assemble'

export function createMockProvider(opts: { chunks?: string[]; failAfter?: number }): Provider {
  const chunks = opts.chunks ?? ['mock response']
  return {
    async *stream(_messages: ChatMessage[]) {
      let i = 0
      for (const c of chunks) {
        if (opts.failAfter != null && i >= opts.failAfter) throw new Error('mock stream failure')
        i++
        yield c
      }
    },
    async complete(_messages: ChatMessage[]) {
      return chunks.join('')
    },
  }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/provider/mock-provider.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/provider/types.ts packages/server/src/provider/mock-provider.ts packages/server/src/provider/mock-provider.test.ts
git commit -m "feat: provider interface and mock provider"
```

---

### Task 14: CodexProvider（真实 Provider）+ 全局配置读取

**Files:**
- Create: `packages/server/src/provider/codex-provider.ts`
- Create: `packages/server/src/provider/registry.ts`
- Create: `packages/server/src/repo/settings-repo.ts`
- Test: `packages/server/src/repo/settings-repo.test.ts`
- Test: `packages/server/src/provider/registry.test.ts`

**Interfaces:**
- Produces:
  - `createSettingsRepo(db)`：`get(key): string | undefined`；`set(key, value): void`；便捷 `getProviderConfig(): { provider: string; model: string; apiKey: string | null; baseUrl: string | null }`（从固定 keys 读取，缺省 provider='codex'）
  - `createCodexProvider(config: { apiKey; model; baseUrl }): Provider` — 用 fetch 调 OpenAI 兼容 `/chat/completions` (stream=true，SSE 解析)。**此任务不做真实网络测试**，仅测"构造 + 配置读取"。
  - `resolveProvider(deps: { settings }, override?: Provider): Provider` — 有 override 用 override（测试/路由注入 mock）；否则按 settings 构造 CodexProvider

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/repo/settings-repo.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo } from './settings-repo'

describe('SettingsRepo', () => {
  it('defaults provider to codex', () => {
    const repo = createSettingsRepo(openMemoryDb())
    expect(repo.getProviderConfig().provider).toBe('codex')
  })
  it('stores and reads keys', () => {
    const repo = createSettingsRepo(openMemoryDb())
    repo.set('provider.model', 'gpt-x')
    expect(repo.get('provider.model')).toBe('gpt-x')
    expect(repo.getProviderConfig().model).toBe('gpt-x')
  })
})
```

```ts
// packages/server/src/provider/registry.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo } from '../repo/settings-repo'
import { resolveProvider } from './registry'
import { createMockProvider } from './mock-provider'

describe('resolveProvider', () => {
  it('returns override when provided', () => {
    const settings = createSettingsRepo(openMemoryDb())
    const mock = createMockProvider({ chunks: ['x'] })
    expect(resolveProvider({ settings }, mock)).toBe(mock)
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/repo/settings-repo.test.ts src/provider/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/repo/settings-repo.ts`:
```ts
import type { Db } from '../db/connection'

export function createSettingsRepo(db: Db) {
  function get(key: string): string | undefined {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
    return r?.value
  }
  function set(key: string, value: string): void {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?')
      .run(key, value, value)
  }
  function getProviderConfig() {
    return {
      provider: get('provider.name') ?? 'codex',
      model: get('provider.model') ?? 'gpt-5-codex',
      apiKey: get('provider.apiKey') ?? null,
      baseUrl: get('provider.baseUrl') ?? null,
    }
  }
  return { get, set, getProviderConfig }
}
```

`packages/server/src/provider/codex-provider.ts`:
```ts
import type { Provider } from './types'
import type { ChatMessage } from '../context/assemble'

export function createCodexProvider(config: {
  apiKey: string | null; model: string; baseUrl: string | null
}): Provider {
  const base = config.baseUrl ?? 'https://api.openai.com/v1'
  async function* stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey ?? ''}`,
      },
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal: opts?.signal,
    })
    if (!res.ok || !res.body) throw new Error(`provider error ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.slice(5).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta as string
        } catch { /* ignore keepalive */ }
      }
    }
  }
  async function complete(messages: ChatMessage[]) {
    let out = ''
    for await (const c of stream(messages)) out += c
    return out
  }
  return { stream, complete }
}
```

`packages/server/src/provider/registry.ts`:
```ts
import type { Provider } from './types'
import type { createSettingsRepo } from '../repo/settings-repo'
import { createCodexProvider } from './codex-provider'

type SettingsRepo = ReturnType<typeof createSettingsRepo>

export function resolveProvider(deps: { settings: SettingsRepo }, override?: Provider): Provider {
  if (override) return override
  const cfg = deps.settings.getProviderConfig()
  return createCodexProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl })
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/repo/settings-repo.test.ts src/provider/registry.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/provider packages/server/src/repo/settings-repo.ts packages/server/src/repo/settings-repo.test.ts
git commit -m "feat: codex provider, settings repo, provider registry"
```

---

### Task 15: 流式作答服务（generateAnswer，落库 + 版本快照）

**Files:**
- Create: `packages/server/src/service/answer-service.ts`
- Test: `packages/server/src/service/answer-service.test.ts`

**Interfaces:**
- Consumes: `NodeRepo`, `VersionRepo`, `SegmentRepo`, `Provider`, `assembleContext`, `prosemirrorToPlainText`
- Produces:
  - `plainTextToProseMirror(text: string): string`（放 `packages/shared/src/prosemirror.ts`，导出）— 把纯文本按行包成 doc JSON
  - `createAnswerService(deps: { nodes; versions; segments })`：
    - `generate(input: { nodeId; userInput; provider; signal? }, onChunk: (c: string) => void): Promise<NodeRow>`
    - 语义：设 node status=`streaming` 写入 userInput；组装上下文；provider.stream，每块调 onChunk 并累积；成功→把累积文本转 ProseMirror JSON 存 ai_response、status=`complete`、写 `node_versions`(`regenerate`)；失败→保留已累积文本、status=`error`、写版本（changeKind `regenerate`），并 rethrow。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/service/answer-service.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createTreeRepo } from '../repo/tree-repo'
import { createNodeRepo } from '../repo/node-repo'
import { createVersionRepo } from '../repo/version-repo'
import { createSegmentRepo } from '../repo/segment-repo'
import { createMockProvider } from '../provider/mock-provider'
import { createAnswerService } from './answer-service'
import { prosemirrorToPlainText } from '@vibe/shared'

function ctx() {
  const db = openMemoryDb(); const clock = fixedClock('2026-08-05T00:00:00.000Z')
  const { tree, rootNode } = createTreeRepo(db, clock).create('t')
  const nodes = createNodeRepo(db, clock)
  const versions = createVersionRepo(db, clock)
  const segments = createSegmentRepo(db)
  return { db, clock, tree, rootNode, nodes, versions, segments }
}

describe('AnswerService', () => {
  it('streams, stores prosemirror response, snapshots version', async () => {
    const c = ctx()
    const svc = createAnswerService({ nodes: c.nodes, versions: c.versions, segments: c.segments })
    const provider = createMockProvider({ chunks: ['缓存', '有多种'] })
    const chunks: string[] = []
    const node = await svc.generate(
      { nodeId: c.rootNode.id, userInput: '讲缓存', provider },
      (ch) => chunks.push(ch),
    )
    expect(chunks).toEqual(['缓存', '有多种'])
    expect(node.status).toBe('complete')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('缓存有多种')
    expect(c.versions.listByNode(c.rootNode.id)).toHaveLength(1)
  })

  it('on failure keeps partial text and marks error', async () => {
    const c = ctx()
    const svc = createAnswerService({ nodes: c.nodes, versions: c.versions, segments: c.segments })
    const provider = createMockProvider({ chunks: ['部分', 'X'], failAfter: 1 })
    await expect(
      svc.generate({ nodeId: c.rootNode.id, userInput: 'q', provider }, () => {}),
    ).rejects.toThrow()
    const node = c.nodes.get(c.rootNode.id)!
    expect(node.status).toBe('error')
    expect(prosemirrorToPlainText(node.ai_response)).toBe('部分')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/service/answer-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

在 `packages/shared/src/prosemirror.ts` 追加：
```ts
export function plainTextToProseMirror(text: string): string {
  const lines = text.split('\n')
  return JSON.stringify({
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  })
}
```

`packages/server/src/service/answer-service.ts`:
```ts
import type { createNodeRepo } from '../repo/node-repo'
import type { createVersionRepo } from '../repo/version-repo'
import type { createSegmentRepo } from '../repo/segment-repo'
import type { Provider } from '../provider/types'
import type { NodeRow } from '@vibe/shared'
import { assembleContext } from '../context/assemble'
import { plainTextToProseMirror } from '@vibe/shared'

type NodeRepo = ReturnType<typeof createNodeRepo>
type VersionRepo = ReturnType<typeof createVersionRepo>
type SegmentRepo = ReturnType<typeof createSegmentRepo>

export function createAnswerService(deps: {
  nodes: NodeRepo; versions: VersionRepo; segments: SegmentRepo
}) {
  async function generate(
    input: { nodeId: string; userInput: string; provider: Provider; signal?: AbortSignal },
    onChunk: (c: string) => void,
  ): Promise<NodeRow> {
    deps.nodes.updateContent(input.nodeId, { userInput: input.userInput, status: 'streaming' })
    const messages = assembleContext(
      { nodes: deps.nodes, versions: deps.versions, segments: deps.segments },
      input.nodeId, input.userInput,
    )
    let acc = ''
    try {
      for await (const chunk of input.provider.stream(messages, { signal: input.signal })) {
        acc += chunk
        onChunk(chunk)
      }
    } catch (err) {
      const pm = plainTextToProseMirror(acc)
      deps.nodes.updateContent(input.nodeId, { aiResponse: pm, status: 'error' })
      deps.versions.snapshot({ nodeId: input.nodeId, userInput: input.userInput, aiResponse: pm, changeKind: 'regenerate' })
      throw err
    }
    const pm = plainTextToProseMirror(acc)
    deps.nodes.updateContent(input.nodeId, { aiResponse: pm, status: 'complete' })
    deps.versions.snapshot({ nodeId: input.nodeId, userInput: input.userInput, aiResponse: pm, changeKind: 'regenerate' })
    return deps.nodes.get(input.nodeId)!
  }
  return { generate }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/shared test && pnpm --filter @vibe/server test src/service/answer-service.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/prosemirror.ts packages/server/src/service/answer-service.ts packages/server/src/service/answer-service.test.ts
git commit -m "feat: streaming answer service with version snapshot"
```

---

## 阶段 E｜HTTP API

> 约定：所有路由挂在 `buildApp` 里，通过一个 `AppDeps` 容器注入所有 repo/service，测试用 `app.inject`。先做容器重构（Task 16），再逐组端点。响应统一 JSON，错误用 Fastify 的 `reply.code(4xx)`。

### Task 16: 依赖容器与 app 装配

**Files:**
- Create: `packages/server/src/deps.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/deps.test.ts`

**Interfaces:**
- Produces:
  - `interface AppDeps { db; clock; trees; nodes; annotations; segments; versions; merges; settings; answer }`
  - `createDeps(opts: { db: Db; clock?: Clock }): AppDeps` — 组装全部 repo + answer service
  - `buildApp(deps?: Partial<AppDeps> & { db?: Db }): FastifyInstance` — 无参时用内存 db（开发默认落地文件在 index.ts 传入）；把 deps 挂到 `app.decorate('deps', ...)`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/deps.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from './db/connection'
import { fixedClock } from './util/clock'
import { createDeps } from './deps'

describe('createDeps', () => {
  it('wires all repos', () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const { tree } = deps.trees.create('t')
    expect(deps.nodes.get(tree.root_node_id!)).toBeTruthy()
    expect(deps.answer).toBeTruthy()
    expect(deps.settings.getProviderConfig().provider).toBe('codex')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/deps.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/deps.ts`:
```ts
import type { Db } from './db/connection'
import { systemClock, type Clock } from './util/clock'
import { createTreeRepo } from './repo/tree-repo'
import { createNodeRepo } from './repo/node-repo'
import { createAnnotationRepo } from './repo/annotation-repo'
import { createSegmentRepo } from './repo/segment-repo'
import { createVersionRepo } from './repo/version-repo'
import { createMergeRepo } from './repo/merge-repo'
import { createSettingsRepo } from './repo/settings-repo'
import { createAnswerService } from './service/answer-service'

export interface AppDeps {
  db: Db; clock: Clock
  trees: ReturnType<typeof createTreeRepo>
  nodes: ReturnType<typeof createNodeRepo>
  annotations: ReturnType<typeof createAnnotationRepo>
  segments: ReturnType<typeof createSegmentRepo>
  versions: ReturnType<typeof createVersionRepo>
  merges: ReturnType<typeof createMergeRepo>
  settings: ReturnType<typeof createSettingsRepo>
  answer: ReturnType<typeof createAnswerService>
}

export function createDeps(opts: { db: Db; clock?: Clock }): AppDeps {
  const clock = opts.clock ?? systemClock
  const db = opts.db
  const nodes = createNodeRepo(db, clock)
  const versions = createVersionRepo(db, clock)
  const segments = createSegmentRepo(db)
  return {
    db, clock,
    trees: createTreeRepo(db, clock),
    nodes, versions, segments,
    annotations: createAnnotationRepo(db, clock),
    merges: createMergeRepo(db, clock),
    settings: createSettingsRepo(db),
    answer: createAnswerService({ nodes, versions, segments }),
  }
}
```

修改 `packages/server/src/app.ts`：
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { openMemoryDb } from './db/connection'
import { createDeps, type AppDeps } from './deps'

declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps }
}

export function buildApp(deps?: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  app.register(cors, { origin: true })
  const resolved = deps ?? createDeps({ db: openMemoryDb() })
  app.decorate('deps', resolved)
  app.get('/health', async () => ({ ok: true }))
  return app
}
```

修改 `packages/server/src/index.ts`：
```ts
import { buildApp } from './app'
import { openDb } from './db/connection'
import { createDeps } from './deps'

const db = openDb(process.env.DB_PATH ?? 'vibe.db')
const app = buildApp(createDeps({ db }))
const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`server on :${port}`))
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/deps.test.ts src/app.test.ts`
Expected: PASS（health 测试仍过）

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/deps.ts packages/server/src/deps.test.ts packages/server/src/app.ts packages/server/src/index.ts
git commit -m "feat: dependency container and app wiring"
```

---

### Task 17: 树与节点读取端点

**Files:**
- Create: `packages/server/src/routes/trees.ts`
- Modify: `packages/server/src/app.ts`（注册路由）
- Test: `packages/server/src/routes/trees.test.ts`

**Interfaces:**
- Produces（`registerTreeRoutes(app)`）：
  - `POST /api/trees { title } → { tree, rootNode }`
  - `GET /api/trees → { trees }`
  - `GET /api/trees/:id → { tree, nodes }`（nodes = 该树全部非删除节点）
  - `GET /api/nodes/:id → { node, annotations, segments }`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routes/trees.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'

function app() {
  return buildApp(createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') }))
}

describe('tree routes', () => {
  it('creates and reads a tree', async () => {
    const a = app()
    const created = await a.inject({ method: 'POST', url: '/api/trees', payload: { title: '缓存' } })
    expect(created.statusCode).toBe(200)
    const { tree, rootNode } = created.json()
    expect(tree.title).toBe('缓存')

    const got = await a.inject({ method: 'GET', url: `/api/trees/${tree.id}` })
    expect(got.json().tree.id).toBe(tree.id)
    expect(got.json().nodes.map((n: any) => n.id)).toContain(rootNode.id)

    const node = await a.inject({ method: 'GET', url: `/api/nodes/${rootNode.id}` })
    expect(node.json().node.id).toBe(rootNode.id)
    expect(Array.isArray(node.json().annotations)).toBe(true)
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routes/trees.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/routes/trees.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export function registerTreeRoutes(app: FastifyInstance): void {
  const d = () => app.deps

  app.post('/api/trees', async (req, reply) => {
    const body = z.object({ title: z.string().min(1) }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid title' })
    return d().trees.create(body.data.title)
  })

  app.get('/api/trees', async () => ({ trees: d().trees.list() }))

  app.get('/api/trees/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const tree = d().trees.get(id)
    if (!tree) return reply.code(404).send({ error: 'not found' })
    const nodes = d().db.prepare('SELECT * FROM nodes WHERE tree_id=? AND is_deleted=0').all(id)
    return { tree, nodes }
  })

  app.get('/api/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const node = d().nodes.get(id)
    if (!node) return reply.code(404).send({ error: 'not found' })
    return {
      node,
      annotations: d().annotations.listByNode(id),
      segments: d().segments.listByNode(id),
    }
  })
}
```

在 `app.ts` 的 `buildApp` 中，`app.decorate` 之后调用 `registerTreeRoutes(app)`（import 之）。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routes/trees.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/trees.ts packages/server/src/app.ts packages/server/src/routes/trees.test.ts
git commit -m "feat: tree and node read endpoints"
```

---

### Task 18: 分叉端点（批注 + 建子节点 + 段）

**Files:**
- Create: `packages/server/src/routes/fork.ts`
- Create: `packages/server/src/service/fork-service.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/service/fork-service.test.ts`
- Test: `packages/server/src/routes/fork.test.ts`

**Interfaces:**
- Produces:
  - `createForkService(deps: { nodes; annotations; segments })`：`fork(input: { parentNodeId; treeId; kind: AnnotationKind; anchorFrom?; anchorTo?; quotedText?; note?; seedText: string }): { annotation; childNode }` — 建 annotation、建 child node（parent=parentNodeId，status `draft`）、linkChild、`buildBranchSegments`
  - `POST /api/nodes/:id/fork { treeId, kind, anchorFrom?, anchorTo?, quotedText?, note?, seedText } → { annotation, childNode }`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/service/fork-service.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createDeps } from '../deps'
import { createForkService } from './fork-service'

describe('ForkService', () => {
  it('creates annotation, child node, and branch segments', () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const { tree, rootNode } = deps.trees.create('t')
    const svc = createForkService(deps)
    const { annotation, childNode } = svc.fork({
      parentNodeId: rootNode.id, treeId: tree.id, kind: 'selection',
      anchorFrom: 0, anchorTo: 5, quotedText: 'Redis', seedText: 'Redis',
    })
    expect(annotation.child_node_id).toBe(childNode.id)
    expect(childNode.parent_id).toBe(rootNode.id)
    const segs = deps.segments.listByNode(childNode.id)
    expect(segs.map((s) => s.type)).toEqual(['ancestor-full', 'annotation-seed'])
  })
})
```

```ts
// packages/server/src/routes/fork.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'

describe('fork route', () => {
  it('forks from a node', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const a = buildApp(deps)
    const { tree, rootNode } = deps.trees.create('t')
    const res = await a.inject({
      method: 'POST', url: `/api/nodes/${rootNode.id}/fork`,
      payload: { treeId: tree.id, kind: 'whole', seedText: '深入这个话题' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().childNode.parent_id).toBe(rootNode.id)
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/service/fork-service.test.ts src/routes/fork.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/service/fork-service.ts`:
```ts
import type { AppDeps } from '../deps'
import type { AnnotationKind } from '@vibe/shared'
import { buildBranchSegments } from '../context/build-branch-segments'

export function createForkService(deps: Pick<AppDeps, 'nodes' | 'annotations' | 'segments'>) {
  function fork(input: {
    parentNodeId: string; treeId: string; kind: AnnotationKind
    anchorFrom?: number | null; anchorTo?: number | null
    quotedText?: string | null; note?: string | null; seedText: string
  }) {
    const annotation = deps.annotations.create({
      nodeId: input.parentNodeId, kind: input.kind,
      anchorFrom: input.anchorFrom ?? null, anchorTo: input.anchorTo ?? null,
      quotedText: input.quotedText ?? null, note: input.note ?? null,
    })
    const childNode = deps.nodes.create({
      treeId: input.treeId, parentId: input.parentNodeId, status: 'draft',
    })
    deps.annotations.linkChild(annotation.id, childNode.id)
    buildBranchSegments(
      { nodes: deps.nodes, segments: deps.segments },
      { childNodeId: childNode.id, parentNodeId: input.parentNodeId, seedText: input.seedText },
    )
    return { annotation: deps.annotations.get(annotation.id)!, childNode }
  }
  return { fork }
}
```

`packages/server/src/routes/fork.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createForkService } from '../service/fork-service'

export function registerForkRoutes(app: FastifyInstance): void {
  app.post('/api/nodes/:id/fork', async (req, reply) => {
    const { id } = req.params as { id: string }
    const schema = z.object({
      treeId: z.string(),
      kind: z.enum(['selection', 'whole']),
      anchorFrom: z.number().nullish(),
      anchorTo: z.number().nullish(),
      quotedText: z.string().nullish(),
      note: z.string().nullish(),
      seedText: z.string(),
    })
    const body = schema.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })
    const svc = createForkService(app.deps)
    return svc.fork({ parentNodeId: id, ...body.data })
  })
}
```

在 `app.ts` 注册 `registerForkRoutes(app)`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/service/fork-service.test.ts src/routes/fork.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/service/fork-service.ts packages/server/src/routes/fork.ts packages/server/src/app.ts packages/server/src/service/fork-service.test.ts packages/server/src/routes/fork.test.ts
git commit -m "feat: fork endpoint creating annotation, child node, segments"
```

---

### Task 19: 流式作答端点（SSE）

**Files:**
- Create: `packages/server/src/routes/answer.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/routes/answer.test.ts`

**Interfaces:**
- Consumes: `AnswerService`, `resolveProvider`（可被测试注入 mock：`app.deps` 上加可选 `providerOverride?: Provider`）
- Produces:
  - 在 `AppDeps` 增加可选字段 `providerOverride?: Provider`（`createDeps` 不设，测试手动塞）
  - `POST /api/nodes/:id/answer { userInput }` → SSE 流，事件：`data: {"type":"chunk","text":"..."}`、结束 `data: {"type":"done","node":{...}}`、错误 `data: {"type":"error","message":"...","node":{...}}`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routes/answer.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createMockProvider } from '../provider/mock-provider'

describe('answer SSE route', () => {
  it('streams chunks then done', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    deps.providerOverride = createMockProvider({ chunks: ['A', 'B'] })
    const a = buildApp(deps)
    const { rootNode } = deps.trees.create('t')
    const res = await a.inject({
      method: 'POST', url: `/api/nodes/${rootNode.id}/answer`,
      payload: { userInput: '讲讲' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('"type":"chunk","text":"A"')
    expect(res.body).toContain('"type":"chunk","text":"B"')
    expect(res.body).toContain('"type":"done"')
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routes/answer.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

在 `deps.ts` 的 `AppDeps` 接口加：`providerOverride?: import('./provider/types').Provider`。

`packages/server/src/routes/answer.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { resolveProvider } from '../provider/registry'

export function registerAnswerRoutes(app: FastifyInstance): void {
  app.post('/api/nodes/:id/answer', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({ userInput: z.string() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`)
    const provider = resolveProvider({ settings: app.deps.settings }, app.deps.providerOverride)
    try {
      const node = await app.deps.answer.generate(
        { nodeId: id, userInput: body.data.userInput, provider },
        (text) => send({ type: 'chunk', text }),
      )
      send({ type: 'done', node })
    } catch (err) {
      const node = app.deps.nodes.get(id)
      send({ type: 'error', message: (err as Error).message, node })
    }
    reply.raw.end()
  })
}
```

在 `app.ts` 注册 `registerAnswerRoutes(app)`。

> 注意：`app.inject` 会等到 `reply.raw.end()` 后返回累积 body，因此测试能一次性拿到全部 SSE 文本。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routes/answer.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/answer.ts packages/server/src/deps.ts packages/server/src/app.ts packages/server/src/routes/answer.test.ts
git commit -m "feat: SSE streaming answer endpoint"
```

---

### Task 20: 节点内容编辑端点（含版本快照）

**Files:**
- Create: `packages/server/src/routes/node-edit.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/routes/node-edit.test.ts`

**Interfaces:**
- Produces:
  - `PATCH /api/nodes/:id { userInput?, aiResponse? } → { node }` — 更新内容并写一条 `node_versions`(`change_kind='edit'`)。aiResponse 传入的是 ProseMirror JSON 字符串。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routes/node-edit.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'

describe('node edit route', () => {
  it('edits content and snapshots a version', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const a = buildApp(deps)
    const { rootNode } = deps.trees.create('t')
    const res = await a.inject({
      method: 'PATCH', url: `/api/nodes/${rootNode.id}`,
      payload: { userInput: '改过的问题' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().node.user_input).toBe('改过的问题')
    expect(deps.versions.listByNode(rootNode.id)).toHaveLength(1)
    expect(deps.versions.listByNode(rootNode.id)[0].change_kind).toBe('edit')
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routes/node-edit.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/routes/node-edit.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export function registerNodeEditRoutes(app: FastifyInstance): void {
  app.patch('/api/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      userInput: z.string().nullish(),
      aiResponse: z.string().nullish(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })
    const existing = app.deps.nodes.get(id)
    if (!existing) return reply.code(404).send({ error: 'not found' })
    const node = app.deps.nodes.updateContent(id, {
      userInput: body.data.userInput ?? undefined,
      aiResponse: body.data.aiResponse ?? undefined,
    })
    app.deps.versions.snapshot({
      nodeId: id, userInput: node.user_input, aiResponse: node.ai_response, changeKind: 'edit',
    })
    return { node }
  })
}
```

在 `app.ts` 注册 `registerNodeEditRoutes(app)`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routes/node-edit.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/node-edit.ts packages/server/src/app.ts packages/server/src/routes/node-edit.test.ts
git commit -m "feat: node content edit endpoint with version snapshot"
```

---

### Task 21: 版本历史、diff、回退端点

**Files:**
- Create: `packages/server/src/service/diff.ts`
- Create: `packages/server/src/routes/versions.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/service/diff.test.ts`
- Test: `packages/server/src/routes/versions.test.ts`

**Interfaces:**
- Produces:
  - `lineDiff(a: string, b: string): Array<{ type: 'same' | 'add' | 'del'; text: string }>` — 简单行级 LCS diff（纯函数，可单测）
  - `GET /api/nodes/:id/versions → { versions }`
  - `GET /api/nodes/:id/versions/:from/diff/:to → { diff }`（对 ai_response 转纯文本后做 lineDiff）
  - `POST /api/nodes/:id/versions/:versionNo/revert → { node }`（读旧版本内容，updateContent 回填，并写一条新 `node_versions`(`change_kind='edit'`)，实现"回退=写新版本"）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/service/diff.test.ts
import { describe, it, expect } from 'vitest'
import { lineDiff } from './diff'

describe('lineDiff', () => {
  it('marks added and deleted lines', () => {
    const d = lineDiff('a\nb\nc', 'a\nx\nc')
    expect(d).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
    ])
  })
  it('all same when identical', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' }, { type: 'same', text: 'b' },
    ])
  })
})
```

```ts
// packages/server/src/routes/versions.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { plainTextToProseMirror } from '@vibe/shared'

describe('version routes', () => {
  it('lists versions and reverts', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const a = buildApp(deps)
    const { rootNode } = deps.trees.create('t')
    // v1
    deps.nodes.updateContent(rootNode.id, { aiResponse: plainTextToProseMirror('版本一'), status: 'complete' })
    deps.versions.snapshot({ nodeId: rootNode.id, userInput: null, aiResponse: plainTextToProseMirror('版本一'), changeKind: 'edit' })
    // v2
    deps.nodes.updateContent(rootNode.id, { aiResponse: plainTextToProseMirror('版本二'), status: 'complete' })
    deps.versions.snapshot({ nodeId: rootNode.id, userInput: null, aiResponse: plainTextToProseMirror('版本二'), changeKind: 'edit' })

    const list = await a.inject({ method: 'GET', url: `/api/nodes/${rootNode.id}/versions` })
    expect(list.json().versions).toHaveLength(2)

    const revert = await a.inject({ method: 'POST', url: `/api/nodes/${rootNode.id}/versions/1/revert` })
    expect(revert.statusCode).toBe(200)
    // 回退后当前内容 = 版本一，且版本数变为 3（只增不减）
    expect(deps.versions.listByNode(rootNode.id)).toHaveLength(3)
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/service/diff.test.ts src/routes/versions.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/service/diff.ts`:
```ts
export type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

export function lineDiff(a: string, b: string): DiffLine[] {
  const as = a.split('\n'); const bs = b.split('\n')
  const n = as.length; const m = bs.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = as[i] === bs[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffLine[] = []
  let i = 0; let j = 0
  while (i < n && j < m) {
    if (as[i] === bs[j]) { out.push({ type: 'same', text: as[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ type: 'del', text: as[i] }); i++ }
    else { out.push({ type: 'add', text: bs[j] }); j++ }
  }
  while (i < n) { out.push({ type: 'del', text: as[i] }); i++ }
  while (j < m) { out.push({ type: 'add', text: bs[j] }); j++ }
  return out
}
```

`packages/server/src/routes/versions.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { prosemirrorToPlainText } from '@vibe/shared'
import { lineDiff } from '../service/diff'

export function registerVersionRoutes(app: FastifyInstance): void {
  app.get('/api/nodes/:id/versions', async (req) => {
    const { id } = req.params as { id: string }
    return { versions: app.deps.versions.listByNode(id) }
  })

  app.get('/api/nodes/:id/versions/:from/diff/:to', async (req, reply) => {
    const { id, from, to } = req.params as { id: string; from: string; to: string }
    const vf = app.deps.versions.get(id, Number(from))
    const vt = app.deps.versions.get(id, Number(to))
    if (!vf || !vt) return reply.code(404).send({ error: 'version not found' })
    return { diff: lineDiff(prosemirrorToPlainText(vf.ai_response), prosemirrorToPlainText(vt.ai_response)) }
  })

  app.post('/api/nodes/:id/versions/:versionNo/revert', async (req, reply) => {
    const { id, versionNo } = req.params as { id: string; versionNo: string }
    const v = app.deps.versions.get(id, Number(versionNo))
    if (!v) return reply.code(404).send({ error: 'version not found' })
    const node = app.deps.nodes.updateContent(id, { userInput: v.user_input, aiResponse: v.ai_response })
    app.deps.versions.snapshot({ nodeId: id, userInput: v.user_input, aiResponse: v.ai_response, changeKind: 'edit' })
    return { node }
  })
}
```

在 `app.ts` 注册 `registerVersionRoutes(app)`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/service/diff.test.ts src/routes/versions.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/service/diff.ts packages/server/src/routes/versions.ts packages/server/src/app.ts packages/server/src/service/diff.test.ts packages/server/src/routes/versions.test.ts
git commit -m "feat: version history, diff, revert endpoints"
```

---

### Task 22: 软删除 / 回收站端点

**Files:**
- Create: `packages/server/src/routes/trash.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/routes/trash.test.ts`

**Interfaces:**
- Produces:
  - `DELETE /api/nodes/:id → { ok: true }`（软删除该节点及子树）
  - `POST /api/nodes/:id/restore → { ok: true }`
  - `GET /api/trees/:treeId/trash → { nodes }`（listDeleted）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routes/trash.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'

describe('trash routes', () => {
  it('soft-deletes, lists trash, and restores', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const a = buildApp(deps)
    const { tree, rootNode } = deps.trees.create('t')
    const child = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id })

    await a.inject({ method: 'DELETE', url: `/api/nodes/${child.id}` })
    const trash = await a.inject({ method: 'GET', url: `/api/trees/${tree.id}/trash` })
    expect(trash.json().nodes.map((n: any) => n.id)).toContain(child.id)

    await a.inject({ method: 'POST', url: `/api/nodes/${child.id}/restore` })
    expect(deps.nodes.get(child.id)?.is_deleted).toBe(0)
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routes/trash.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/routes/trash.ts`:
```ts
import type { FastifyInstance } from 'fastify'

export function registerTrashRoutes(app: FastifyInstance): void {
  app.delete('/api/nodes/:id', async (req) => {
    const { id } = req.params as { id: string }
    app.deps.nodes.softDelete(id)
    return { ok: true }
  })
  app.post('/api/nodes/:id/restore', async (req) => {
    const { id } = req.params as { id: string }
    app.deps.nodes.restore(id)
    return { ok: true }
  })
  app.get('/api/trees/:treeId/trash', async (req) => {
    const { treeId } = req.params as { treeId: string }
    return { nodes: app.deps.nodes.listDeleted(treeId) }
  })
}
```

在 `app.ts` 注册 `registerTrashRoutes(app)`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routes/trash.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/trash.ts packages/server/src/app.ts packages/server/src/routes/trash.test.ts
git commit -m "feat: soft-delete and trash endpoints"
```

---

## 阶段 F｜并行路由（v1 亮点）

### Task 23: 路由判定类型 + 置信度收敛纯逻辑

**Files:**
- Create: `packages/server/src/routing/types.ts`
- Create: `packages/server/src/routing/converge.ts`
- Test: `packages/server/src/routing/converge.test.ts`

**Interfaces:**
- Produces（导出，前后端共用可再镜像到 shared，此处放 server）：
  - `interface RouteCandidate { target: RouteTarget; refId: string | null; label: string; confidence: number }`（refId：bound-subdoc=子节点id，new-branch=主文档中对应段/锚点提示id 或 null，main-continuation=null）
  - `interface RouteDecision { candidates: RouteCandidate[] }`
  - `type Convergence = { mode: 'auto'; chosen: RouteCandidate } | { mode: 'ask'; candidates: RouteCandidate[] }`
  - `convergeRoute(decision: RouteDecision, opts?: { highThreshold?: number; leadMargin?: number }): Convergence`
  - 规则：candidates 按 confidence 降序；若为空 → auto 选 main-continuation（合成一个默认候选）；若最高 ≥ highThreshold(默认0.7) 且 (最高 - 次高) ≥ leadMargin(默认0.2) → `auto`；否则 `ask`（返回 top3）。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routing/converge.test.ts
import { describe, it, expect } from 'vitest'
import { convergeRoute } from './converge'
import type { RouteDecision } from './types'

const c = (target: any, confidence: number, refId: string | null = null) =>
  ({ target, refId, label: String(target), confidence })

describe('convergeRoute', () => {
  it('auto-picks a confident, clear leader', () => {
    const d: RouteDecision = { candidates: [c('new-branch', 0.85, 'seg1'), c('main-continuation', 0.4)] }
    const r = convergeRoute(d)
    expect(r.mode).toBe('auto')
    if (r.mode === 'auto') expect(r.chosen.target).toBe('new-branch')
  })
  it('asks when leader is not confident enough', () => {
    const d: RouteDecision = { candidates: [c('new-branch', 0.55, 's'), c('main-continuation', 0.45)] }
    expect(convergeRoute(d).mode).toBe('ask')
  })
  it('asks when top two are too close', () => {
    const d: RouteDecision = { candidates: [c('new-branch', 0.75, 's'), c('bound-subdoc', 0.72, 'n1')] }
    expect(convergeRoute(d).mode).toBe('ask')
  })
  it('defaults to main-continuation when no candidates', () => {
    const r = convergeRoute({ candidates: [] })
    expect(r.mode).toBe('auto')
    if (r.mode === 'auto') expect(r.chosen.target).toBe('main-continuation')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routing/converge.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/routing/types.ts`:
```ts
import type { RouteTarget } from '@vibe/shared'

export interface RouteCandidate {
  target: RouteTarget
  refId: string | null
  label: string
  confidence: number
}
export interface RouteDecision { candidates: RouteCandidate[] }
export interface RouteOutline {
  mainDocSummary: string
  segments: Array<{ id: string; text: string }>
  subdocs: Array<{ nodeId: string; title: string }>
}
export type Convergence =
  | { mode: 'auto'; chosen: RouteCandidate }
  | { mode: 'ask'; candidates: RouteCandidate[] }
```

`packages/server/src/routing/converge.ts`:
```ts
import type { RouteDecision, Convergence, RouteCandidate } from './types'

const MAIN: RouteCandidate = {
  target: 'main-continuation', refId: null, label: '主文档延续', confidence: 1,
}

export function convergeRoute(
  decision: RouteDecision,
  opts?: { highThreshold?: number; leadMargin?: number },
): Convergence {
  const high = opts?.highThreshold ?? 0.7
  const margin = opts?.leadMargin ?? 0.2
  const sorted = [...decision.candidates].sort((a, b) => b.confidence - a.confidence)
  if (sorted.length === 0) return { mode: 'auto', chosen: MAIN }
  const top = sorted[0]
  const second = sorted[1]?.confidence ?? 0
  if (top.confidence >= high && top.confidence - second >= margin) {
    return { mode: 'auto', chosen: top }
  }
  return { mode: 'ask', candidates: sorted.slice(0, 3) }
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routing/converge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routing/types.ts packages/server/src/routing/converge.ts packages/server/src/routing/converge.test.ts
git commit -m "feat: route confidence convergence logic"
```

---

### Task 24: 路由判定服务（大纲构造 + Provider 分类 + mock）

**Files:**
- Create: `packages/server/src/routing/outline.ts`
- Create: `packages/server/src/routing/route-service.ts`
- Create: `packages/server/src/routing/mock-router.ts`
- Test: `packages/server/src/routing/outline.test.ts`
- Test: `packages/server/src/routing/route-service.test.ts`

**Interfaces:**
- Produces:
  - `buildOutline(deps: { nodes; annotations }, mainNodeId: string): RouteOutline` — mainDocSummary=主节点 ai_response 首段纯文本；segments=主节点各批注的 quoted_text（id=annotation.id）；subdocs=各批注已链接的子节点（title=子节点 user_input 首行或"未命名"）
  - `interface Router { classify(question: string, outline: RouteOutline): Promise<RouteDecision> }`
  - `createMockRouter(decision: RouteDecision): Router`
  - `createRouteService(deps: { nodes; annotations })`：`route(input: { mainNodeId; question; router }): Promise<Convergence>` — buildOutline → router.classify → convergeRoute

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routing/outline.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createDeps } from '../deps'
import { buildOutline } from './outline'
import { plainTextToProseMirror } from '@vibe/shared'

describe('buildOutline', () => {
  it('summarizes main doc, its annotations and subdocs', () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const { tree, rootNode } = deps.trees.create('t')
    deps.nodes.updateContent(rootNode.id, { aiResponse: plainTextToProseMirror('缓存方案\n细节'), status: 'complete' })
    const ann = deps.annotations.create({ nodeId: rootNode.id, kind: 'selection', quotedText: 'Redis' })
    const child = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: 'Redis 深入' })
    deps.annotations.linkChild(ann.id, child.id)

    const o = buildOutline(deps, rootNode.id)
    expect(o.mainDocSummary).toContain('缓存方案')
    expect(o.segments[0].text).toBe('Redis')
    expect(o.subdocs[0].title).toBe('Redis 深入')
  })
})
```

```ts
// packages/server/src/routing/route-service.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createDeps } from '../deps'
import { createRouteService } from './route-service'
import { createMockRouter } from './mock-router'

describe('RouteService', () => {
  it('converges to auto when router is confident', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const { rootNode } = deps.trees.create('t')
    const router = createMockRouter({
      candidates: [
        { target: 'new-branch', refId: 'segX', label: '新分支', confidence: 0.9 },
        { target: 'main-continuation', refId: null, label: '主文档', confidence: 0.3 },
      ],
    })
    const svc = createRouteService(deps)
    const r = await svc.route({ mainNodeId: rootNode.id, question: 'q', router })
    expect(r.mode).toBe('auto')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routing/outline.test.ts src/routing/route-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/routing/outline.ts`:
```ts
import type { AppDeps } from '../deps'
import type { RouteOutline } from './types'
import { prosemirrorToPlainText } from '@vibe/shared'

export function buildOutline(
  deps: Pick<AppDeps, 'nodes' | 'annotations'>,
  mainNodeId: string,
): RouteOutline {
  const node = deps.nodes.get(mainNodeId)
  const full = prosemirrorToPlainText(node?.ai_response ?? null)
  const anns = deps.annotations.listByNode(mainNodeId)
  const segments = anns
    .filter((a) => a.quoted_text)
    .map((a) => ({ id: a.id, text: a.quoted_text as string }))
  const subdocs = anns
    .filter((a) => a.child_node_id)
    .map((a) => {
      const child = deps.nodes.get(a.child_node_id!)
      const title = (child?.user_input ?? '').split('\n')[0] || '未命名'
      return { nodeId: a.child_node_id as string, title }
    })
  return { mainDocSummary: full.split('\n')[0] ?? '', segments, subdocs }
}
```

`packages/server/src/routing/mock-router.ts`:
```ts
import type { RouteDecision, RouteOutline } from './types'

export interface Router {
  classify(question: string, outline: RouteOutline): Promise<RouteDecision>
}
export function createMockRouter(decision: RouteDecision): Router {
  return { async classify() { return decision } }
}
```

`packages/server/src/routing/route-service.ts`:
```ts
import type { AppDeps } from '../deps'
import type { Convergence } from './types'
import type { Router } from './mock-router'
import { buildOutline } from './outline'
import { convergeRoute } from './converge'

export function createRouteService(deps: Pick<AppDeps, 'nodes' | 'annotations'>) {
  async function route(input: {
    mainNodeId: string; question: string; router: Router
  }): Promise<Convergence> {
    const outline = buildOutline(deps, input.mainNodeId)
    const decision = await input.router.classify(input.question, outline)
    return convergeRoute(decision)
  }
  return { route }
}
```

> 真实 Codex router（用 provider.complete + JSON 提示）留待前后端联调，v1 可先接一个 `createLlmRouter(provider)`，但其质量靠人工 eval，不在自动化测试内。此任务只测 mock 路径。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routing/outline.test.ts src/routing/route-service.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routing/outline.ts packages/server/src/routing/route-service.ts packages/server/src/routing/mock-router.ts packages/server/src/routing/outline.test.ts packages/server/src/routing/route-service.test.ts
git commit -m "feat: routing outline and route service with mock router"
```

---

### Task 25: 迁移改挂服务（migrate，改 parent + 重建段）

**Files:**
- Create: `packages/server/src/service/migrate-service.ts`
- Create: `packages/server/src/routes/route.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/service/migrate-service.test.ts`
- Test: `packages/server/src/routes/route.test.ts`

**Interfaces:**
- Produces:
  - `createMigrateService(deps: { nodes; segments; db })`：`migrate(input: { nodeId; target: RouteTarget; newParentId: string; seedText?: string }): NodeRow` — 改挂不重答：把 node 的 `parent_id` 改为 newParentId；删除该 node 现有 context_segments；`buildBranchSegments`（用 newParentId 路径 + seedText，seedText 缺省用空串对应 main-continuation 时可跳过 seed）。语义：main-continuation 迁移 = 挂到目标主文档节点下、无 seed；new-branch/bound-subdoc = 挂到目标下 + seed。
  - `POST /api/route { mainNodeId, question, providerHint? } → Convergence`（用真实/注入 router；测试注入 mock via `app.deps.routerOverride`）
  - `POST /api/nodes/:id/migrate { target, newParentId, seedText? } → { node }`
  - `AppDeps` 增加可选 `routerOverride?: Router`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/service/migrate-service.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createDeps } from '../deps'
import { createMigrateService } from './migrate-service'

describe('MigrateService', () => {
  it('rehooks a node to a new parent and rebuilds segments (no re-answer)', () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const { tree, rootNode } = deps.trees.create('t')
    // 一个作为新落点的主文档段落节点
    const other = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: '其它主题' })
    // 原本挂在 root 下、已生成内容的节点
    const answered = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: 'q' })
    deps.nodes.updateContent(answered.id, { aiResponse: '{"type":"doc","content":[]}', status: 'complete' })

    const svc = createMigrateService(deps)
    const moved = svc.migrate({ nodeId: answered.id, target: 'new-branch', newParentId: other.id, seedText: '深入' })

    expect(moved.parent_id).toBe(other.id)
    expect(moved.ai_response).toBe('{"type":"doc","content":[]}') // 内容未变（不重答）
    const segs = deps.segments.listByNode(answered.id)
    // 新父路径 root->other 两个 ancestor-full + seed
    expect(segs.map((s) => s.type)).toEqual(['ancestor-full', 'ancestor-full', 'annotation-seed'])
    expect(segs[1].ref_node_id).toBe(other.id)
  })
})
```

```ts
// packages/server/src/routes/route.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createMockRouter } from '../routing/mock-router'

describe('route endpoint', () => {
  it('returns convergence using injected router', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    deps.routerOverride = createMockRouter({
      candidates: [{ target: 'main-continuation', refId: null, label: '主', confidence: 0.95 }],
    })
    const a = buildApp(deps)
    const { rootNode } = deps.trees.create('t')
    const res = await a.inject({
      method: 'POST', url: '/api/route',
      payload: { mainNodeId: rootNode.id, question: '继续说' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().mode).toBe('auto')
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/service/migrate-service.test.ts src/routes/route.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

在 `deps.ts` 的 `AppDeps` 加：`routerOverride?: import('./routing/mock-router').Router`。

`packages/server/src/service/migrate-service.ts`:
```ts
import type { AppDeps } from '../deps'
import type { NodeRow, RouteTarget } from '@vibe/shared'
import { buildBranchSegments } from '../context/build-branch-segments'

export function createMigrateService(deps: Pick<AppDeps, 'nodes' | 'segments' | 'db'>) {
  function migrate(input: {
    nodeId: string; target: RouteTarget; newParentId: string; seedText?: string
  }): NodeRow {
    const tx = deps.db.transaction(() => {
      deps.db.prepare('UPDATE nodes SET parent_id=? WHERE id=?').run(input.newParentId, input.nodeId)
      deps.db.prepare('DELETE FROM context_segments WHERE node_id=?').run(input.nodeId)
      buildBranchSegments(
        { nodes: deps.nodes, segments: deps.segments },
        { childNodeId: input.nodeId, parentNodeId: input.newParentId, seedText: input.seedText ?? '' },
      )
    })
    tx()
    return deps.nodes.get(input.nodeId)!
  }
  return { migrate }
}
```

`packages/server/src/routes/route.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createRouteService } from '../routing/route-service'
import { createMigrateService } from '../service/migrate-service'

export function registerRouteRoutes(app: FastifyInstance): void {
  app.post('/api/route', async (req, reply) => {
    const body = z.object({ mainNodeId: z.string(), question: z.string() }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })
    const router = app.deps.routerOverride
    if (!router) return reply.code(503).send({ error: 'router not configured' })
    const svc = createRouteService(app.deps)
    return svc.route({ mainNodeId: body.data.mainNodeId, question: body.data.question, router })
  })

  app.post('/api/nodes/:id/migrate', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      target: z.enum(['main-continuation', 'bound-subdoc', 'new-branch']),
      newParentId: z.string(),
      seedText: z.string().nullish(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })
    const svc = createMigrateService(app.deps)
    const node = svc.migrate({
      nodeId: id, target: body.data.target,
      newParentId: body.data.newParentId, seedText: body.data.seedText ?? undefined,
    })
    return { node }
  })
}
```

在 `app.ts` 注册 `registerRouteRoutes(app)`。

> 真实 router：`createLlmRouter(provider)` 用 `provider.complete` 发一个"给定问题+大纲，输出候选 JSON"的提示，解析成 `RouteDecision`。在 `index.ts` 里把 `deps.routerOverride = createLlmRouter(resolveProvider(...))` 接上（生产用），测试用 mock。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/service/migrate-service.test.ts src/routes/route.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/service/migrate-service.ts packages/server/src/routes/route.ts packages/server/src/deps.ts packages/server/src/app.ts packages/server/src/service/migrate-service.test.ts packages/server/src/routes/route.test.ts
git commit -m "feat: route endpoint and migrate (rehook) service"
```

---

### Task 26: 合并端点（提炼结论 + 回填父节点段 + 记录）

**Files:**
- Create: `packages/server/src/service/merge-service.ts`
- Create: `packages/server/src/routes/merge.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/service/merge-service.test.ts`

**Interfaces:**
- Consumes: `NodeRepo`, `SegmentRepo`, `VersionRepo`, `MergeRepo`, `Provider`, `assembleContext`
- Produces:
  - `createMergeService(deps: { nodes; segments; versions; merges })`：`merge(input: { sourceNodeId; targetNodeId; provider }): Promise<{ merge; segment }>` — 用 provider.complete 把 source 子树对话提炼成结论文本（v1：整段落到分叉点=父节点）；往 target 追加一个 `merged-conclusion` 段（seq=nextSeq）；写 target 一条 `node_versions`(`change_kind='merge'`)；记 `merges`。子树不删。
  - `POST /api/merges { sourceNodeId, targetNodeId } → { merge, segment }`（provider 用 `resolveProvider` + `providerOverride`）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/service/merge-service.test.ts
import { describe, it, expect } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'
import { createDeps } from '../deps'
import { createMergeService } from './merge-service'
import { createMockProvider } from '../provider/mock-provider'

describe('MergeService', () => {
  it('distills conclusion, appends merged-conclusion segment, records merge, keeps subtree', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const { tree, rootNode } = deps.trees.create('t')
    const child = deps.nodes.create({ treeId: tree.id, parentId: rootNode.id, userInput: 'q' })
    deps.nodes.updateContent(child.id, { aiResponse: '{"type":"doc","content":[]}', status: 'complete' })

    const svc = createMergeService(deps)
    const provider = createMockProvider({ chunks: ['结论：用 Redis'] })
    const { merge, segment } = await svc.merge({ sourceNodeId: child.id, targetNodeId: rootNode.id, provider })

    expect(segment.type).toBe('merged-conclusion')
    expect(segment.content).toBe('结论：用 Redis')
    expect(merge.target_node_id).toBe(rootNode.id)
    expect(deps.merges.listByTarget(rootNode.id)).toHaveLength(1)
    // 子树保留
    expect(deps.nodes.get(child.id)?.is_deleted).toBe(0)
    // 父节点有一条 merge 版本
    expect(deps.versions.listByNode(rootNode.id).some((v) => v.change_kind === 'merge')).toBe(true)
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/service/merge-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/service/merge-service.ts`:
```ts
import type { AppDeps } from '../deps'
import type { Provider } from '../provider/types'
import type { MergeRow, ContextSegmentRow } from '@vibe/shared'
import { assembleContext } from '../context/assemble'

export function createMergeService(
  deps: Pick<AppDeps, 'nodes' | 'segments' | 'versions' | 'merges'>,
) {
  async function merge(input: {
    sourceNodeId: string; targetNodeId: string; provider: Provider
  }): Promise<{ merge: MergeRow; segment: ContextSegmentRow }> {
    const messages = assembleContext(
      { nodes: deps.nodes, versions: deps.versions, segments: deps.segments },
      input.sourceNodeId,
      '请把以上探索提炼成给父级参考的简明结论。',
    )
    const conclusion = await input.provider.complete(messages)

    const seq = deps.segments.nextSeq(input.targetNodeId)
    const segment = deps.segments.add({
      nodeId: input.targetNodeId, seq, type: 'merged-conclusion', content: conclusion,
    })
    const target = deps.nodes.get(input.targetNodeId)!
    deps.versions.snapshot({
      nodeId: input.targetNodeId, userInput: target.user_input, aiResponse: target.ai_response, changeKind: 'merge',
    })
    const merge = deps.merges.record({
      sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId,
      conclusion, landingSegmentId: segment.id,
    })
    return { merge, segment }
  }
  return { merge }
}
```

`packages/server/src/routes/merge.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createMergeService } from '../service/merge-service'
import { resolveProvider } from '../provider/registry'

export function registerMergeRoutes(app: FastifyInstance): void {
  app.post('/api/merges', async (req, reply) => {
    const body = z.object({
      sourceNodeId: z.string(), targetNodeId: z.string(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })
    const provider = resolveProvider({ settings: app.deps.settings }, app.deps.providerOverride)
    const svc = createMergeService(app.deps)
    return svc.merge({ ...body.data, provider })
  })
}
```

在 `app.ts` 注册 `registerMergeRoutes(app)`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/service/merge-service.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/service/merge-service.ts packages/server/src/routes/merge.ts packages/server/src/app.ts packages/server/src/service/merge-service.test.ts
git commit -m "feat: merge service and endpoint (distill conclusion into parent)"
```

---

## 阶段 G｜前端基础

> 前端测试用 @testing-library/react + jsdom（已在 Task 3 配好）。网络层用 fetch，SSE 用原生 EventSource 不便 POST，故用 fetch + ReadableStream 读取。所有 API 调用集中在 `api/client.ts`，便于 mock。

### Task 27: API client（类型化封装）

**Files:**
- Create: `packages/web/src/api/client.ts`
- Test: `packages/web/src/api/client.test.ts`

**Interfaces:**
- Consumes: `@vibe/shared` 的 Row 类型
- Produces（`api` 对象）：
  - `createTree(title): Promise<{ tree: TreeRow; rootNode: NodeRow }>`
  - `listTrees(): Promise<{ trees: TreeRow[] }>`
  - `getTree(id): Promise<{ tree: TreeRow; nodes: NodeRow[] }>`
  - `getNode(id): Promise<{ node: NodeRow; annotations: AnnotationRow[]; segments: ContextSegmentRow[] }>`
  - `fork(nodeId, body): Promise<{ annotation: AnnotationRow; childNode: NodeRow }>`
  - `route(mainNodeId, question): Promise<Convergence>`（Convergence 类型镜像到 `packages/web/src/api/types.ts`）
  - `migrate(nodeId, body): Promise<{ node: NodeRow }>`
  - `editNode(nodeId, body): Promise<{ node: NodeRow }>`
  - `listVersions(nodeId): Promise<{ versions: NodeVersionRow[] }>`
  - `revert(nodeId, versionNo): Promise<{ node: NodeRow }>`
  - `deleteNode/restoreNode/getTrash`
  - `merge(sourceNodeId, targetNodeId): Promise<{ merge: MergeRow; segment: ContextSegmentRow }>`
  - `streamAnswer(nodeId, userInput, handlers: { onChunk; onDone; onError }): Promise<void>` — fetch POST 读 SSE 流
  - 基址 `/api`（Vite proxy 转发到 4000）；注入 `fetchImpl` 便于测试

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/api/client.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createApi } from './client'

describe('api client', () => {
  it('createTree posts title and returns json', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ tree: { id: 't1', title: 'x' }, rootNode: { id: 'n1' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as any
    const api = createApi({ fetchImpl })
    const r = await api.createTree('x')
    expect(r.tree.id).toBe('t1')
    expect(fetchImpl).toHaveBeenCalledWith('/api/trees', expect.objectContaining({ method: 'POST' }))
  })

  it('streamAnswer parses SSE chunks', async () => {
    const body = 'data: {"type":"chunk","text":"A"}\n\ndata: {"type":"chunk","text":"B"}\n\ndata: {"type":"done","node":{"id":"n1"}}\n\n'
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })) as any
    const api = createApi({ fetchImpl })
    const chunks: string[] = []
    let done: any = null
    await api.streamAnswer('n1', 'q', {
      onChunk: (t) => chunks.push(t),
      onDone: (n) => { done = n },
      onError: () => {},
    })
    expect(chunks).toEqual(['A', 'B'])
    expect(done.id).toBe('n1')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/api/client.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/api/types.ts`:
```ts
import type { RouteTarget } from '@vibe/shared'
export interface RouteCandidate { target: RouteTarget; refId: string | null; label: string; confidence: number }
export type Convergence =
  | { mode: 'auto'; chosen: RouteCandidate }
  | { mode: 'ask'; candidates: RouteCandidate[] }
```

`packages/web/src/api/client.ts`:
```ts
import type {
  TreeRow, NodeRow, AnnotationRow, ContextSegmentRow, NodeVersionRow, MergeRow, AnnotationKind,
} from '@vibe/shared'
import type { Convergence } from './types'

export function createApi(opts?: { fetchImpl?: typeof fetch; base?: string }) {
  const f = opts?.fetchImpl ?? fetch
  const base = opts?.base ?? '/api'
  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await f(base + url, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<T>
  }
  return {
    createTree: (title: string) =>
      json<{ tree: TreeRow; rootNode: NodeRow }>('/trees', { method: 'POST', body: JSON.stringify({ title }) }),
    listTrees: () => json<{ trees: TreeRow[] }>('/trees'),
    getTree: (id: string) => json<{ tree: TreeRow; nodes: NodeRow[] }>(`/trees/${id}`),
    getNode: (id: string) =>
      json<{ node: NodeRow; annotations: AnnotationRow[]; segments: ContextSegmentRow[] }>(`/nodes/${id}`),
    fork: (nodeId: string, body: {
      treeId: string; kind: AnnotationKind; anchorFrom?: number | null; anchorTo?: number | null
      quotedText?: string | null; note?: string | null; seedText: string
    }) => json<{ annotation: AnnotationRow; childNode: NodeRow }>(`/nodes/${nodeId}/fork`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    route: (mainNodeId: string, question: string) =>
      json<Convergence>('/route', { method: 'POST', body: JSON.stringify({ mainNodeId, question }) }),
    migrate: (nodeId: string, body: { target: string; newParentId: string; seedText?: string }) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}/migrate`, { method: 'POST', body: JSON.stringify(body) }),
    editNode: (nodeId: string, body: { userInput?: string; aiResponse?: string }) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    listVersions: (nodeId: string) => json<{ versions: NodeVersionRow[] }>(`/nodes/${nodeId}/versions`),
    revert: (nodeId: string, versionNo: number) =>
      json<{ node: NodeRow }>(`/nodes/${nodeId}/versions/${versionNo}/revert`, { method: 'POST' }),
    deleteNode: (nodeId: string) => json<{ ok: true }>(`/nodes/${nodeId}`, { method: 'DELETE' }),
    restoreNode: (nodeId: string) => json<{ ok: true }>(`/nodes/${nodeId}/restore`, { method: 'POST' }),
    getTrash: (treeId: string) => json<{ nodes: NodeRow[] }>(`/trees/${treeId}/trash`),
    merge: (sourceNodeId: string, targetNodeId: string) =>
      json<{ merge: MergeRow; segment: ContextSegmentRow }>('/merges', {
        method: 'POST', body: JSON.stringify({ sourceNodeId, targetNodeId }),
      }),
    async streamAnswer(
      nodeId: string, userInput: string,
      handlers: { onChunk: (t: string) => void; onDone: (n: NodeRow) => void; onError: (m: string) => void },
    ) {
      const res = await f(`${base}/nodes/${nodeId}/answer`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userInput }),
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const p of parts) {
          const line = p.trim()
          if (!line.startsWith('data:')) continue
          const evt = JSON.parse(line.slice(5).trim())
          if (evt.type === 'chunk') handlers.onChunk(evt.text)
          else if (evt.type === 'done') handlers.onDone(evt.node)
          else if (evt.type === 'error') handlers.onError(evt.message)
        }
      }
    },
  }
}

export type Api = ReturnType<typeof createApi>
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/api/client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/api/client.ts packages/web/src/api/types.ts packages/web/src/api/client.test.ts
git commit -m "feat: typed api client with SSE stream parsing"
```

---

### Task 28: 工作台状态 store（栏位角色 + 当前树）

**Files:**
- Create: `packages/web/src/state/workbench-store.ts`
- Test: `packages/web/src/state/workbench-store.test.ts`

**Interfaces:**
- Produces（用 zustand，加依赖 `zustand`）：
  - `useWorkbench` store，state：`treeId`, `nodesById: Record<string, NodeRow>`, `mainNodeId: string | null`, `subdocTabs: string[]`（子文档 node id 列表）, `activeSubdocId: string | null`, `focusMode: boolean`
  - actions：`loadTree(payload)`, `setMain(nodeId)`, `openSubdocTab(nodeId)`, `setActiveSubdoc(nodeId)`, `promoteSubdoc(nodeId)`（聚焦晋升：把该子文档设为 main，subdocTabs 清空/重建为其子节点，见测试）, `toggleFocus()`, `upsertNode(node)`
  - 纯逻辑 `computeChildTabs(nodesById, parentId): string[]` — 返回该父节点的直接子节点 id（用于晋升后重建 tabs）

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/state/workbench-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbench, computeChildTabs } from './workbench-store'
import type { NodeRow } from '@vibe/shared'

const mk = (id: string, parent: string | null): NodeRow => ({
  id, tree_id: 't', parent_id: parent, sort_order: 0, user_input: null, ai_response: null,
  status: 'complete', is_deleted: 0, model_override: null, created_at: '', updated_at: '',
})

describe('workbench store', () => {
  beforeEach(() => useWorkbench.getState().reset())

  it('loads tree and sets main to root', () => {
    const root = mk('root', null)
    useWorkbench.getState().loadTree({ treeId: 't', rootNodeId: 'root', nodes: [root] })
    expect(useWorkbench.getState().mainNodeId).toBe('root')
  })

  it('computeChildTabs returns direct children', () => {
    const nodes = { root: mk('root', null), a: mk('a', 'root'), b: mk('b', 'root'), c: mk('c', 'a') }
    expect(computeChildTabs(nodes, 'root').sort()).toEqual(['a', 'b'])
  })

  it('promoteSubdoc makes node main and rebuilds tabs from its children', () => {
    const nodes = [mk('root', null), mk('a', 'root'), mk('c', 'a')]
    const s = useWorkbench.getState()
    s.loadTree({ treeId: 't', rootNodeId: 'root', nodes })
    s.openSubdocTab('a')
    s.promoteSubdoc('a')
    expect(useWorkbench.getState().mainNodeId).toBe('a')
    expect(useWorkbench.getState().subdocTabs).toEqual(['c'])
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/state/workbench-store.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

加依赖：`packages/web/package.json` dependencies 增 `"zustand": "^4.5.0"`，然后 `pnpm install`。

`packages/web/src/state/workbench-store.ts`:
```ts
import { create } from 'zustand'
import type { NodeRow } from '@vibe/shared'

export function computeChildTabs(nodesById: Record<string, NodeRow>, parentId: string): string[] {
  return Object.values(nodesById)
    .filter((n) => n.parent_id === parentId && n.is_deleted === 0)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((n) => n.id)
}

interface State {
  treeId: string | null
  rootNodeId: string | null
  nodesById: Record<string, NodeRow>
  mainNodeId: string | null
  subdocTabs: string[]
  activeSubdocId: string | null
  focusMode: boolean
  loadTree(p: { treeId: string; rootNodeId: string; nodes: NodeRow[] }): void
  setMain(nodeId: string): void
  openSubdocTab(nodeId: string): void
  setActiveSubdoc(nodeId: string): void
  promoteSubdoc(nodeId: string): void
  toggleFocus(): void
  upsertNode(node: NodeRow): void
  reset(): void
}

const initial = {
  treeId: null, rootNodeId: null, nodesById: {}, mainNodeId: null,
  subdocTabs: [], activeSubdocId: null, focusMode: false,
}

export const useWorkbench = create<State>((set, get) => ({
  ...initial,
  loadTree: (p) => set({
    treeId: p.treeId, rootNodeId: p.rootNodeId,
    nodesById: Object.fromEntries(p.nodes.map((n) => [n.id, n])),
    mainNodeId: p.rootNodeId, subdocTabs: [], activeSubdocId: null,
  }),
  setMain: (nodeId) => set({
    mainNodeId: nodeId,
    subdocTabs: computeChildTabs(get().nodesById, nodeId),
    activeSubdocId: null,
  }),
  openSubdocTab: (nodeId) => set((s) =>
    s.subdocTabs.includes(nodeId)
      ? { activeSubdocId: nodeId }
      : { subdocTabs: [...s.subdocTabs, nodeId], activeSubdocId: nodeId }),
  setActiveSubdoc: (nodeId) => set({ activeSubdocId: nodeId }),
  promoteSubdoc: (nodeId) => set((s) => ({
    mainNodeId: nodeId,
    subdocTabs: computeChildTabs(s.nodesById, nodeId),
    activeSubdocId: null,
  })),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  upsertNode: (node) => set((s) => ({ nodesById: { ...s.nodesById, [node.id]: node } })),
  reset: () => set(initial),
}))
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/state/workbench-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/state/workbench-store.ts packages/web/src/state/workbench-store.test.ts packages/web/package.json pnpm-lock.yaml
git commit -m "feat: workbench store with column roles and promote logic"
```

---

### Task 29: 三栏布局壳 + 沉浸切换

**Files:**
- Create: `packages/web/src/components/Workbench.tsx`
- Create: `packages/web/src/components/Workbench.css`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/components/Workbench.test.tsx`

**Interfaces:**
- Consumes: `useWorkbench`
- Produces: `<Workbench/>` 渲染三个区域 `data-testid="tree-panel"` / `"main-doc"` / `"subdoc-panel"`；`focusMode` 为 true 时隐藏 `tree-panel`（用 `data-focus` 标记，CSS 隐藏）。提供"聚焦/退出聚焦"按钮 `aria-label="toggle-focus"`。

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/Workbench.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Workbench } from './Workbench'
import { useWorkbench } from '../state/workbench-store'

describe('Workbench layout', () => {
  beforeEach(() => useWorkbench.getState().reset())
  it('renders three panels and toggles focus', () => {
    render(<Workbench />)
    expect(screen.getByTestId('tree-panel')).toBeInTheDocument()
    expect(screen.getByTestId('main-doc')).toBeInTheDocument()
    expect(screen.getByTestId('subdoc-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('toggle-focus'))
    expect(screen.getByTestId('workbench')).toHaveAttribute('data-focus', 'true')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/Workbench.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/components/Workbench.tsx`:
```tsx
import { useWorkbench } from '../state/workbench-store'
import './Workbench.css'

export function Workbench() {
  const focusMode = useWorkbench((s) => s.focusMode)
  const toggleFocus = useWorkbench((s) => s.toggleFocus)
  return (
    <div className="workbench" data-testid="workbench" data-focus={focusMode}>
      <aside className="tree-panel" data-testid="tree-panel">树导航</aside>
      <main className="main-doc" data-testid="main-doc">
        <button aria-label="toggle-focus" onClick={toggleFocus}>
          {focusMode ? '退出聚焦' : '聚焦'}
        </button>
        主文档
      </main>
      <section className="subdoc-panel" data-testid="subdoc-panel">子文档</section>
    </div>
  )
}
```

`packages/web/src/components/Workbench.css`:
```css
.workbench { display: grid; grid-template-columns: 240px 1fr 1fr; height: 100vh; }
.workbench[data-focus='true'] { grid-template-columns: 0 1fr 0; }
.workbench[data-focus='true'] .tree-panel,
.workbench[data-focus='true'] .subdoc-panel { display: none; }
.tree-panel { border-right: 1px solid #ddd; overflow: auto; }
.main-doc { overflow: auto; padding: 16px; }
.subdoc-panel { border-left: 1px solid #ddd; overflow: auto; }
```

`App.tsx` 改为渲染 `<Workbench/>`（保留标题在 tree-panel 顶部可选）。同时更新 `App.test.tsx`：把断言从 `getByText('树形对话工作台')` 改为 `getByTestId('workbench')`，或在 Workbench 内保留标题文本。为不破坏 Task 3 测试，在 `tree-panel` 内加 `<h1>树形对话工作台</h1>`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/components/Workbench.test.tsx src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/Workbench.tsx packages/web/src/components/Workbench.css packages/web/src/App.tsx
git commit -m "feat: three-column workbench layout with focus toggle"
```

---

### Task 30: 树导航 + 面包屑 + 前进/后退

**Files:**
- Create: `packages/web/src/components/TreePanel.tsx`
- Create: `packages/web/src/components/Breadcrumb.tsx`
- Create: `packages/web/src/state/history.ts`
- Modify: `packages/web/src/components/Workbench.tsx`
- Test: `packages/web/src/components/TreePanel.test.tsx`
- Test: `packages/web/src/state/history.test.ts`

**Interfaces:**
- Produces:
  - `createHistory()`：`{ push(id), back(): string | null, forward(): string | null, canBack(), canForward() }`（纯逻辑，可单测）
  - `<TreePanel/>`：从 store 的 `nodesById` 渲染嵌套树；点节点调 `setMain`；已合并节点（有 merge 记录的暂用 `merged` 标记，v1 简化：node 有子且其 annotation 有 merge — 前端先按"有 merged-conclusion 段"判断，简化用 label 占位）；节点显示 `user_input` 首行或"根"
  - `<Breadcrumb/>`：从 `mainNodeId` 沿 `parent_id` 到根，渲染路径，点击某级 `setMain`

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/state/history.test.ts
import { describe, it, expect } from 'vitest'
import { createHistory } from './history'

describe('navigation history', () => {
  it('supports back and forward', () => {
    const h = createHistory()
    h.push('a'); h.push('b'); h.push('c')
    expect(h.back()).toBe('b')
    expect(h.back()).toBe('a')
    expect(h.forward()).toBe('b')
    expect(h.canForward()).toBe(true)
  })
})
```

```tsx
// packages/web/src/components/TreePanel.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TreePanel } from './TreePanel'
import { useWorkbench } from '../state/workbench-store'
import type { NodeRow } from '@vibe/shared'

const mk = (id: string, parent: string | null, input: string | null): NodeRow => ({
  id, tree_id: 't', parent_id: parent, sort_order: 0, user_input: input, ai_response: null,
  status: 'complete', is_deleted: 0, model_override: null, created_at: '', updated_at: '',
})

describe('TreePanel', () => {
  beforeEach(() => useWorkbench.getState().reset())
  it('renders nodes and sets main on click', () => {
    const nodes = [mk('root', null, null), mk('a', 'root', '缓存问题')]
    useWorkbench.getState().loadTree({ treeId: 't', rootNodeId: 'root', nodes })
    render(<TreePanel />)
    fireEvent.click(screen.getByText('缓存问题'))
    expect(useWorkbench.getState().mainNodeId).toBe('a')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/state/history.test.ts src/components/TreePanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/state/history.ts`:
```ts
export function createHistory() {
  const stack: string[] = []
  let idx = -1
  return {
    push(id: string) { stack.splice(idx + 1); stack.push(id); idx = stack.length - 1 },
    back(): string | null { if (idx > 0) { idx--; return stack[idx] } return null },
    forward(): string | null { if (idx < stack.length - 1) { idx++; return stack[idx] } return null },
    canBack() { return idx > 0 },
    canForward() { return idx < stack.length - 1 },
  }
}
```

`packages/web/src/components/TreePanel.tsx`:
```tsx
import { useWorkbench } from '../state/workbench-store'
import type { NodeRow } from '@vibe/shared'

function label(n: NodeRow): string {
  if (!n.parent_id) return '根'
  return (n.user_input ?? '').split('\n')[0] || '未命名'
}

function Branch({ id }: { id: string }) {
  const nodesById = useWorkbench((s) => s.nodesById)
  const setMain = useWorkbench((s) => s.setMain)
  const mainNodeId = useWorkbench((s) => s.mainNodeId)
  const node = nodesById[id]
  if (!node) return null
  const children = Object.values(nodesById)
    .filter((n) => n.parent_id === id && n.is_deleted === 0)
    .sort((a, b) => a.sort_order - b.sort_order)
  return (
    <li>
      <button data-active={mainNodeId === id} onClick={() => setMain(id)}>{label(node)}</button>
      {children.length > 0 && <ul>{children.map((c) => <Branch key={c.id} id={c.id} />)}</ul>}
    </li>
  )
}

export function TreePanel() {
  const rootNodeId = useWorkbench((s) => s.rootNodeId)
  if (!rootNodeId) return <div>暂无内容</div>
  return <ul className="tree-root"><Branch id={rootNodeId} /></ul>
}
```

`packages/web/src/components/Breadcrumb.tsx`:
```tsx
import { useWorkbench } from '../state/workbench-store'

export function Breadcrumb() {
  const nodesById = useWorkbench((s) => s.nodesById)
  const mainNodeId = useWorkbench((s) => s.mainNodeId)
  const setMain = useWorkbench((s) => s.setMain)
  const path: string[] = []
  let cur = mainNodeId
  while (cur) { path.unshift(cur); cur = nodesById[cur]?.parent_id ?? null }
  return (
    <nav className="breadcrumb">
      {path.map((id, i) => {
        const n = nodesById[id]
        const text = !n?.parent_id ? '根' : (n?.user_input ?? '').split('\n')[0] || '未命名'
        return (
          <span key={id}>
            {i > 0 && ' › '}
            <button onClick={() => setMain(id)}>{text}</button>
          </span>
        )
      })}
    </nav>
  )
}
```

在 `Workbench.tsx`：tree-panel 内渲染 `<TreePanel/>`，main-doc 顶部渲染 `<Breadcrumb/>`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/state/history.test.ts src/components/TreePanel.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/TreePanel.tsx packages/web/src/components/Breadcrumb.tsx packages/web/src/state/history.ts packages/web/src/components/Workbench.tsx packages/web/src/components/TreePanel.test.tsx packages/web/src/state/history.test.ts
git commit -m "feat: tree navigation, breadcrumb, and history"
```

---

## 阶段 H｜前端文档与批注

> ProseMirror/TipTap 完整编辑器集成较重。v1 前端把 AI 回复渲染为**只读富文本**（用 `prosemirrorToPlainText` 分段渲染成 `<p>`），批注用字符 offset 高亮。真正的 TipTap 编辑器留到编辑体验打磨（仍属 v1 范围但作为渐进增强，测试聚焦纯逻辑）。

### Task 31: 只读文档渲染 + 选区捕获

**Files:**
- Create: `packages/web/src/components/DocView.tsx`
- Create: `packages/web/src/doc/selection.ts`
- Test: `packages/web/src/doc/selection.test.ts`
- Test: `packages/web/src/components/DocView.test.tsx`

**Interfaces:**
- Produces:
  - `getPlainSelection(container: HTMLElement): { from: number; to: number; text: string } | null` — 基于 `window.getSelection()` 计算相对于容器纯文本的字符 offset（纯逻辑，用 jsdom Range 测试）
  - `<DocView node={NodeRow} onSelect={(sel)=>void} />` — 渲染 `ai_response` 纯文本分段；`data-testid="doc-view"`；`status==='streaming'` 显示流式光标；`status==='error'` 显示"生成中断，重试"按钮（`aria-label="retry"`，v1 触发 `onRetry` 回调）
  - 简化：offset 以整个 DocView 纯文本（各段以 `\n` 连接）为基准，与后端 `prosemirrorToPlainText` 一致

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/doc/selection.test.ts
import { describe, it, expect } from 'vitest'
import { getPlainSelection } from './selection'

describe('getPlainSelection', () => {
  it('returns null when no selection', () => {
    const div = document.createElement('div')
    div.textContent = 'hello'
    document.body.appendChild(div)
    window.getSelection()?.removeAllRanges()
    expect(getPlainSelection(div)).toBeNull()
  })
  it('computes offsets for a selection within a single text node', () => {
    const div = document.createElement('div')
    div.textContent = 'hello world'
    document.body.appendChild(div)
    const range = document.createRange()
    range.setStart(div.firstChild!, 6)
    range.setEnd(div.firstChild!, 11)
    const sel = window.getSelection()!
    sel.removeAllRanges(); sel.addRange(range)
    expect(getPlainSelection(div)).toEqual({ from: 6, to: 11, text: 'world' })
  })
})
```

```tsx
// packages/web/src/components/DocView.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocView } from './DocView'
import type { NodeRow } from '@vibe/shared'
import { plainTextToProseMirror } from '@vibe/shared'

const node = (over: Partial<NodeRow>): NodeRow => ({
  id: 'n', tree_id: 't', parent_id: null, sort_order: 0, user_input: 'Q',
  ai_response: plainTextToProseMirror('第一段\n第二段'), status: 'complete',
  is_deleted: 0, model_override: null, created_at: '', updated_at: '', ...over,
})

describe('DocView', () => {
  it('renders paragraphs', () => {
    render(<DocView node={node({})} onSelect={() => {}} onRetry={() => {}} />)
    expect(screen.getByText('第一段')).toBeInTheDocument()
    expect(screen.getByText('第二段')).toBeInTheDocument()
  })
  it('shows retry on error', () => {
    render(<DocView node={node({ status: 'error' })} onSelect={() => {}} onRetry={() => {}} />)
    expect(screen.getByLabelText('retry')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/doc/selection.test.ts src/components/DocView.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/doc/selection.ts`:
```ts
export function getPlainSelection(
  container: HTMLElement,
): { from: number; to: number; text: string } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const pre = range.cloneRange()
  pre.selectNodeContents(container)
  pre.setEnd(range.startContainer, range.startOffset)
  const from = pre.toString().length
  const text = range.toString()
  return { from, to: from + text.length, text }
}
```

`packages/web/src/components/DocView.tsx`:
```tsx
import { useRef } from 'react'
import type { NodeRow } from '@vibe/shared'
import { prosemirrorToPlainText } from '@vibe/shared'
import { getPlainSelection } from '../doc/selection'

export function DocView(props: {
  node: NodeRow
  onSelect: (sel: { from: number; to: number; text: string }) => void
  onRetry: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const text = prosemirrorToPlainText(props.node.ai_response)
  const paragraphs = text.split('\n')
  function handleMouseUp() {
    if (!ref.current) return
    const sel = getPlainSelection(ref.current)
    if (sel) props.onSelect(sel)
  }
  return (
    <div>
      <div data-testid="doc-view" ref={ref} onMouseUp={handleMouseUp}>
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {props.node.status === 'streaming' && <span className="cursor">▍</span>}
      {props.node.status === 'error' && (
        <button aria-label="retry" onClick={props.onRetry}>生成中断，重试</button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/doc/selection.test.ts src/components/DocView.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/DocView.tsx packages/web/src/doc/selection.ts packages/web/src/doc/selection.test.ts packages/web/src/components/DocView.test.tsx
git commit -m "feat: read-only doc view with plain-text selection capture"
```

---

### Task 32: 批注高亮渲染

**Files:**
- Create: `packages/web/src/doc/highlight.ts`
- Modify: `packages/web/src/components/DocView.tsx`
- Test: `packages/web/src/doc/highlight.test.ts`

**Interfaces:**
- Produces:
  - `splitByAnnotations(text: string, anns: Array<{ id: string; from: number; to: number }>): Array<{ text: string; annId: string | null }>` — 把整段纯文本按批注区间切成片段，重叠时以先出现者优先（纯逻辑，单测）。DocView 用它渲染 `<mark data-ann-id>`。

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/doc/highlight.test.ts
import { describe, it, expect } from 'vitest'
import { splitByAnnotations } from './highlight'

describe('splitByAnnotations', () => {
  it('splits plain text into marked and unmarked runs', () => {
    const runs = splitByAnnotations('hello world', [{ id: 'a1', from: 6, to: 11 }])
    expect(runs).toEqual([
      { text: 'hello ', annId: null },
      { text: 'world', annId: 'a1' },
    ])
  })
  it('handles no annotations', () => {
    expect(splitByAnnotations('abc', [])).toEqual([{ text: 'abc', annId: null }])
  })
  it('handles two disjoint annotations', () => {
    const runs = splitByAnnotations('abcdef', [{ id: 'x', from: 0, to: 2 }, { id: 'y', from: 4, to: 6 }])
    expect(runs).toEqual([
      { text: 'ab', annId: 'x' },
      { text: 'cd', annId: null },
      { text: 'ef', annId: 'y' },
    ])
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/doc/highlight.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/doc/highlight.ts`:
```ts
export interface Run { text: string; annId: string | null }

export function splitByAnnotations(
  text: string,
  anns: Array<{ id: string; from: number; to: number }>,
): Run[] {
  const sorted = [...anns].sort((a, b) => a.from - b.from)
  const runs: Run[] = []
  let pos = 0
  for (const a of sorted) {
    if (a.from < pos) continue // 跳过重叠
    if (a.from > pos) runs.push({ text: text.slice(pos, a.from), annId: null })
    runs.push({ text: text.slice(a.from, a.to), annId: a.id })
    pos = a.to
  }
  if (pos < text.length) runs.push({ text: text.slice(pos), annId: null })
  if (runs.length === 0) runs.push({ text, annId: null })
  return runs
}
```

修改 `DocView.tsx`：接收 `annotations` prop（`Array<{ id; from; to }>`），当整篇按单段处理时用 `splitByAnnotations` 渲染。为与 Task 31 的分段渲染兼容，v1 简化：DocView 用整篇纯文本 + 高亮 runs 渲染在一个容器内（不再逐段 `<p>`，改为 runs：普通文本 span，批注文本 `<mark data-ann-id={id}>`）。相应更新 Task 31 中"renders paragraphs"测试：改为断言文本出现（`screen.getByText(/第一段/)` 用 `exact:false`）。

> DocView 渲染策略调整（记录以保持一致）：把 `text` 传给 `splitByAnnotations`，遍历 runs 渲染；换行 `\n` 用 `white-space: pre-wrap` 保留。annotations 为空时即单个普通 run。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/doc/highlight.test.ts src/components/DocView.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/doc/highlight.ts packages/web/src/components/DocView.tsx packages/web/src/doc/highlight.test.ts packages/web/src/components/DocView.test.tsx
git commit -m "feat: annotation highlight runs in doc view"
```

---

### Task 33: 批注气泡 + 发起分叉

**Files:**
- Create: `packages/web/src/components/AnnotationBubble.tsx`
- Test: `packages/web/src/components/AnnotationBubble.test.tsx`

**Interfaces:**
- Produces:
  - `<AnnotationBubble selection={{from,to,text}} onCreateNote={(note)=>void} onForkExpand={(seedText)=>void} onDismiss={()=>void} />`
  - 显示选中文本预览；一个笔记输入框 + "保存笔记"；一个"就此展开"输入追问 + 按钮（点后调 `onForkExpand(seedText)`，seedText 默认=选中文本，可编辑）；"取消"

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/AnnotationBubble.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnnotationBubble } from './AnnotationBubble'

describe('AnnotationBubble', () => {
  it('fires onForkExpand with question text', () => {
    const onForkExpand = vi.fn()
    render(
      <AnnotationBubble
        selection={{ from: 0, to: 5, text: 'Redis' }}
        onCreateNote={() => {}} onForkExpand={onForkExpand} onDismiss={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '它怎么持久化' } })
    fireEvent.click(screen.getByText('就此展开'))
    expect(onForkExpand).toHaveBeenCalledWith('它怎么持久化')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/AnnotationBubble.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/components/AnnotationBubble.tsx`:
```tsx
import { useState } from 'react'

export function AnnotationBubble(props: {
  selection: { from: number; to: number; text: string }
  onCreateNote: (note: string) => void
  onForkExpand: (seedText: string) => void
  onDismiss: () => void
}) {
  const [note, setNote] = useState('')
  const [question, setQuestion] = useState('')
  return (
    <div className="annotation-bubble" role="dialog">
      <blockquote>{props.selection.text}</blockquote>
      <div>
        <textarea aria-label="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="写笔记" />
        <button onClick={() => props.onCreateNote(note)}>保存笔记</button>
      </div>
      <div>
        <textarea aria-label="fork-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="就此追问…" />
        <button onClick={() => props.onForkExpand(question)}>就此展开</button>
      </div>
      <button onClick={props.onDismiss}>取消</button>
    </div>
  )
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/components/AnnotationBubble.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/AnnotationBubble.tsx packages/web/src/components/AnnotationBubble.test.tsx
git commit -m "feat: annotation bubble with fork expand"
```

---

### Task 34: 子文档 Tabs 组件

**Files:**
- Create: `packages/web/src/components/SubdocTabs.tsx`
- Test: `packages/web/src/components/SubdocTabs.test.tsx`

**Interfaces:**
- Consumes: `useWorkbench`（`subdocTabs`, `activeSubdocId`, `setActiveSubdoc`, `promoteSubdoc`, `nodesById`）
- Produces: `<SubdocTabs/>` 渲染一排 tab（label=子节点 user_input 首行/"未命名"），点 tab 调 `setActiveSubdoc`；当前 active tab 显示其内容区（渲染子节点 DocView 只读预览）+ "聚焦此文档"按钮（`aria-label="promote"`）调 `promoteSubdoc`

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/SubdocTabs.test.tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SubdocTabs } from './SubdocTabs'
import { useWorkbench } from '../state/workbench-store'
import type { NodeRow } from '@vibe/shared'

const mk = (id: string, parent: string | null, input: string): NodeRow => ({
  id, tree_id: 't', parent_id: parent, sort_order: 0, user_input: input, ai_response: null,
  status: 'complete', is_deleted: 0, model_override: null, created_at: '', updated_at: '',
})

describe('SubdocTabs', () => {
  beforeEach(() => useWorkbench.getState().reset())
  it('shows tabs and promotes on click', () => {
    const nodes = [mk('root', null, ''), mk('a', 'root', 'Redis 深入'), mk('b', 'root', '内存方案')]
    const s = useWorkbench.getState()
    s.loadTree({ treeId: 't', rootNodeId: 'root', nodes })
    s.openSubdocTab('a'); s.openSubdocTab('b')
    render(<SubdocTabs />)
    expect(screen.getByText('Redis 深入')).toBeInTheDocument()
    expect(screen.getByText('内存方案')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('promote'))
    // 默认 active 是最后打开的 b
    expect(useWorkbench.getState().mainNodeId).toBe('b')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/SubdocTabs.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/components/SubdocTabs.tsx`:
```tsx
import { useWorkbench } from '../state/workbench-store'

function title(input: string | null): string {
  return (input ?? '').split('\n')[0] || '未命名'
}

export function SubdocTabs() {
  const tabs = useWorkbench((s) => s.subdocTabs)
  const active = useWorkbench((s) => s.activeSubdocId)
  const nodesById = useWorkbench((s) => s.nodesById)
  const setActive = useWorkbench((s) => s.setActiveSubdoc)
  const promote = useWorkbench((s) => s.promoteSubdoc)
  if (tabs.length === 0) return <div className="subdoc-empty">暂无子文档</div>
  const current = active ?? tabs[tabs.length - 1]
  return (
    <div className="subdoc-tabs">
      <div className="tab-strip" role="tablist">
        {tabs.map((id) => (
          <button key={id} role="tab" aria-selected={id === current} onClick={() => setActive(id)}>
            {title(nodesById[id]?.user_input ?? null)}
          </button>
        ))}
      </div>
      <div className="tab-body">
        <button aria-label="promote" onClick={() => promote(current)}>聚焦此文档 ⤢</button>
      </div>
    </div>
  )
}
```

在 `Workbench.tsx` 的 subdoc-panel 内渲染 `<SubdocTabs/>`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/components/SubdocTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/SubdocTabs.tsx packages/web/src/components/Workbench.tsx packages/web/src/components/SubdocTabs.test.tsx
git commit -m "feat: subdoc tabs with promote"
```

---

### Task 35: 主文档容器（编排 DocView + 批注 + 分叉调用）

**Files:**
- Create: `packages/web/src/components/MainDoc.tsx`
- Modify: `packages/web/src/components/Workbench.tsx`
- Test: `packages/web/src/components/MainDoc.test.tsx`

**Interfaces:**
- Consumes: `useWorkbench`, `Api`（通过 `ApiContext` 注入，便于测试传 mock）
- Produces:
  - `ApiProvider` + `useApi()`（`packages/web/src/api/context.tsx`）
  - `<MainDoc/>`：渲染 `mainNodeId` 对应节点的 `<DocView/>`；选区 → 显示 `<AnnotationBubble/>`；"就此展开" → 调 `api.fork(...)` → `upsertNode(childNode)` + `openSubdocTab(childNode.id)`

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/MainDoc.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MainDoc } from './MainDoc'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import type { NodeRow } from '@vibe/shared'
import { plainTextToProseMirror } from '@vibe/shared'

const mk = (id: string, parent: string | null, over: Partial<NodeRow> = {}): NodeRow => ({
  id, tree_id: 't', parent_id: parent, sort_order: 0, user_input: 'Q',
  ai_response: plainTextToProseMirror('讲了 Redis 和内存'), status: 'complete',
  is_deleted: 0, model_override: null, created_at: '', updated_at: '', ...over,
})

function fakeApi() {
  return {
    fork: vi.fn(async () => ({
      annotation: { id: 'ann1' } as any,
      childNode: mk('child', 'root', { user_input: '深入' }),
    })),
  } as any
}

describe('MainDoc fork flow', () => {
  beforeEach(() => useWorkbench.getState().reset())
  it('creates a subdoc tab after fork expand', async () => {
    useWorkbench.getState().loadTree({ treeId: 't', rootNodeId: 'root', nodes: [mk('root', null)] })
    const api = fakeApi()
    render(<ApiProvider api={api}><MainDoc /></ApiProvider>)

    // 模拟选区
    const dv = screen.getByTestId('doc-view')
    const range = document.createRange()
    range.selectNodeContents(dv)
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range)
    fireEvent.mouseUp(dv)

    fireEvent.change(screen.getByLabelText('fork-question'), { target: { value: '深入' } })
    fireEvent.click(screen.getByText('就此展开'))

    await waitFor(() => {
      expect(api.fork).toHaveBeenCalled()
      expect(useWorkbench.getState().subdocTabs).toContain('child')
    })
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/MainDoc.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/api/context.tsx`:
```tsx
import { createContext, useContext } from 'react'
import type { Api } from './client'

const ApiContext = createContext<Api | null>(null)

export function ApiProvider({ api, children }: { api: Api; children: React.ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}
export function useApi(): Api {
  const api = useContext(ApiContext)
  if (!api) throw new Error('ApiProvider missing')
  return api
}
```

`packages/web/src/components/MainDoc.tsx`:
```tsx
import { useState } from 'react'
import { useWorkbench } from '../state/workbench-store'
import { useApi } from '../api/context'
import { DocView } from './DocView'
import { AnnotationBubble } from './AnnotationBubble'

export function MainDoc() {
  const api = useApi()
  const mainNodeId = useWorkbench((s) => s.mainNodeId)
  const treeId = useWorkbench((s) => s.treeId)
  const nodesById = useWorkbench((s) => s.nodesById)
  const upsertNode = useWorkbench((s) => s.upsertNode)
  const openSubdocTab = useWorkbench((s) => s.openSubdocTab)
  const [sel, setSel] = useState<{ from: number; to: number; text: string } | null>(null)

  if (!mainNodeId) return <div data-testid="main-doc-empty">选择一个节点</div>
  const node = nodesById[mainNodeId]
  if (!node) return null

  async function forkExpand(seedText: string) {
    const { childNode } = await api.fork(mainNodeId!, {
      treeId: treeId!, kind: 'selection',
      anchorFrom: sel?.from ?? null, anchorTo: sel?.to ?? null,
      quotedText: sel?.text ?? null, seedText,
    })
    upsertNode(childNode)
    openSubdocTab(childNode.id)
    setSel(null)
  }

  return (
    <div>
      <DocView node={node} onSelect={setSel} onRetry={() => {}} />
      {sel && (
        <AnnotationBubble
          selection={sel}
          onCreateNote={() => setSel(null)}
          onForkExpand={forkExpand}
          onDismiss={() => setSel(null)}
        />
      )}
    </div>
  )
}
```

在 `Workbench.tsx` main-doc 内渲染 `<Breadcrumb/>` + `<MainDoc/>`（替换占位"主文档"文字），并把整个 App 包在 `<ApiProvider api={createApi()}>` 中（在 `App.tsx`）。更新 App.test.tsx：包 ApiProvider。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/components/MainDoc.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/MainDoc.tsx packages/web/src/api/context.tsx packages/web/src/components/Workbench.tsx packages/web/src/App.tsx packages/web/src/components/MainDoc.test.tsx
git commit -m "feat: main doc container wiring fork flow"
```

---

## 阶段 I｜前端交互整合

### Task 36: 对话框 + 并行路由（乐观作答 + 判定并发）

**Files:**
- Create: `packages/web/src/components/ChatBox.tsx`
- Create: `packages/web/src/flow/parallel-ask.ts`
- Modify: `packages/web/src/components/MainDoc.tsx`
- Test: `packages/web/src/flow/parallel-ask.test.ts`
- Test: `packages/web/src/components/ChatBox.test.tsx`

**Interfaces:**
- Produces:
  - `parallelAsk(deps: { api }, input: { mainNodeId; question }, handlers: { onChunk; onDone; onError; onRoute }): Promise<void>` — **并发**发起 `api.streamAnswer`（乐观落主文档延续，需先有个"当前作答节点"——v1 简化：作答落在 mainNodeId 节点本身的新一轮，实际实现见说明）与 `api.route`；两者独立 await，路由结果通过 `onRoute(convergence)` 回调（不阻塞流）。
  - `<ChatBox onSubmit={(q)=>void} disabled={boolean} />`
  - 说明：v1 作答语义——底部提问时，先在 store 里"以 mainNodeId 为父建一个乐观子节点"作为答案容器（前端本地 id，收到 done 后用后端返回 node 替换）。为控制复杂度，Task 36 只测 `parallelAsk` 的并发编排（两个回调都被调用、路由不阻塞 chunk），UI 容器替换在 Task 37 完善。

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/flow/parallel-ask.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parallelAsk } from './parallel-ask'

describe('parallelAsk', () => {
  it('runs answer streaming and routing concurrently', async () => {
    const order: string[] = []
    const api = {
      streamAnswer: vi.fn(async (_n: string, _q: string, h: any) => {
        h.onChunk('A'); order.push('chunk'); h.onDone({ id: 'n1' })
      }),
      route: vi.fn(async () => { order.push('route'); return { mode: 'auto', chosen: { target: 'main-continuation', refId: null, label: 'x', confidence: 1 } } }),
    } as any
    const chunks: string[] = []
    let routed: any = null
    await parallelAsk({ api }, { mainNodeId: 'n1', question: 'q' }, {
      onChunk: (t) => chunks.push(t),
      onDone: () => {},
      onError: () => {},
      onRoute: (c) => { routed = c },
    })
    expect(chunks).toEqual(['A'])
    expect(routed.mode).toBe('auto')
    expect(api.streamAnswer).toHaveBeenCalled()
    expect(api.route).toHaveBeenCalled()
  })
})
```

```tsx
// packages/web/src/components/ChatBox.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatBox } from './ChatBox'

describe('ChatBox', () => {
  it('submits question text', () => {
    const onSubmit = vi.fn()
    render(<ChatBox onSubmit={onSubmit} disabled={false} />)
    fireEvent.change(screen.getByLabelText('chat-input'), { target: { value: '继续说说' } })
    fireEvent.click(screen.getByText('发送'))
    expect(onSubmit).toHaveBeenCalledWith('继续说说')
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/flow/parallel-ask.test.ts src/components/ChatBox.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/flow/parallel-ask.ts`:
```ts
import type { Api } from '../api/client'
import type { Convergence } from '../api/types'
import type { NodeRow } from '@vibe/shared'

export async function parallelAsk(
  deps: { api: Api },
  input: { mainNodeId: string; question: string },
  handlers: {
    onChunk: (t: string) => void
    onDone: (n: NodeRow) => void
    onError: (m: string) => void
    onRoute: (c: Convergence) => void
  },
): Promise<void> {
  const answer = deps.api.streamAnswer(input.mainNodeId, input.question, {
    onChunk: handlers.onChunk, onDone: handlers.onDone, onError: handlers.onError,
  })
  const routing = deps.api
    .route(input.mainNodeId, input.question)
    .then(handlers.onRoute)
    .catch(() => { /* 路由失败静默降级：留在主文档 */ })
  await Promise.all([answer, routing])
}
```

`packages/web/src/components/ChatBox.tsx`:
```tsx
import { useState } from 'react'

export function ChatBox({ onSubmit, disabled }: { onSubmit: (q: string) => void; disabled: boolean }) {
  const [q, setQ] = useState('')
  return (
    <div className="chat-box">
      <textarea aria-label="chat-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="继续提问…" />
      <button disabled={disabled} onClick={() => { if (q.trim()) { onSubmit(q); setQ('') } }}>发送</button>
    </div>
  )
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/flow/parallel-ask.test.ts src/components/ChatBox.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/flow/parallel-ask.ts packages/web/src/components/ChatBox.tsx packages/web/src/flow/parallel-ask.test.ts packages/web/src/components/ChatBox.test.tsx
git commit -m "feat: chat box and parallel ask orchestration"
```

---

### Task 37: 作答容器编排 + 路由收敛 UI（迁移提示 / 候选面板）

**Files:**
- Create: `packages/web/src/components/RoutePrompt.tsx`
- Create: `packages/web/src/flow/answer-flow.ts`
- Modify: `packages/web/src/components/MainDoc.tsx`
- Test: `packages/web/src/flow/answer-flow.test.ts`
- Test: `packages/web/src/components/RoutePrompt.test.tsx`

**Interfaces:**
- Produces:
  - `decideRouteUi(convergence, optimisticParentId): { action: 'none' } | { action: 'suggest'; candidate } | { action: 'ask'; candidates }` — 纯逻辑：`auto` 且 chosen.target==='main-continuation' → `none`；`auto` 且指向别处 → `suggest`；`ask` → `ask`（单测）
  - `<RoutePrompt decision onAccept={(candidate)=>void} onPick={(candidate)=>void} onDismiss={()=>void} />` — suggest 显示"这轮更像在深入【label】，搬过去？"[搬移][留下]；ask 列候选 + "都不对，接主文档下"
  - MainDoc：接入 ChatBox → 建乐观答案节点（前端临时 id，父=mainNodeId）→ `parallelAsk`；`onRoute` → `decideRouteUi` → 视情况渲染 `<RoutePrompt/>`；接受迁移 → `api.migrate(answerNodeId, { target, newParentId: candidate.refId!, seedText })` → 更新 store（改父、可能移入 subdocTab）

- [ ] **Step 1: 写失败测试**

```ts
// packages/web/src/flow/answer-flow.test.ts
import { describe, it, expect } from 'vitest'
import { decideRouteUi } from './answer-flow'

const cand = (target: any, refId: string | null = null) => ({ target, refId, label: 'L', confidence: 0.9 })

describe('decideRouteUi', () => {
  it('no-op when auto main-continuation', () => {
    expect(decideRouteUi({ mode: 'auto', chosen: cand('main-continuation') }, 'p').action).toBe('none')
  })
  it('suggests migration when auto points elsewhere', () => {
    const r = decideRouteUi({ mode: 'auto', chosen: cand('new-branch', 'seg1') }, 'p')
    expect(r.action).toBe('suggest')
  })
  it('asks when ambiguous', () => {
    const r = decideRouteUi({ mode: 'ask', candidates: [cand('new-branch', 's'), cand('bound-subdoc', 'n')] }, 'p')
    expect(r.action).toBe('ask')
  })
})
```

```tsx
// packages/web/src/components/RoutePrompt.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoutePrompt } from './RoutePrompt'

describe('RoutePrompt', () => {
  it('accepts a suggested migration', () => {
    const onAccept = vi.fn()
    render(
      <RoutePrompt
        decision={{ action: 'suggest', candidate: { target: 'new-branch', refId: 's1', label: '缓存细节', confidence: 0.9 } }}
        onAccept={onAccept} onPick={() => {}} onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/缓存细节/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('搬过去'))
    expect(onAccept).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/flow/answer-flow.test.ts src/components/RoutePrompt.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/flow/answer-flow.ts`:
```ts
import type { Convergence, RouteCandidate } from '../api/types'

export type RouteUi =
  | { action: 'none' }
  | { action: 'suggest'; candidate: RouteCandidate }
  | { action: 'ask'; candidates: RouteCandidate[] }

export function decideRouteUi(c: Convergence, _optimisticParentId: string): RouteUi {
  if (c.mode === 'auto') {
    if (c.chosen.target === 'main-continuation') return { action: 'none' }
    return { action: 'suggest', candidate: c.chosen }
  }
  return { action: 'ask', candidates: c.candidates }
}
```

`packages/web/src/components/RoutePrompt.tsx`:
```tsx
import type { RouteUi } from '../flow/answer-flow'
import type { RouteCandidate } from '../api/types'

export function RoutePrompt(props: {
  decision: RouteUi
  onAccept: (c: RouteCandidate) => void
  onPick: (c: RouteCandidate) => void
  onDismiss: () => void
}) {
  if (props.decision.action === 'none') return null
  if (props.decision.action === 'suggest') {
    const c = props.decision.candidate
    return (
      <div className="route-prompt" role="alert">
        <span>这轮更像在深入【{c.label}】，搬过去？</span>
        <button onClick={() => props.onAccept(c)}>搬过去</button>
        <button onClick={props.onDismiss}>留下</button>
      </div>
    )
  }
  return (
    <div className="route-prompt" role="dialog">
      <span>这轮放到哪里？</span>
      {props.decision.candidates.map((c) => (
        <button key={`${c.target}:${c.refId}`} onClick={() => props.onPick(c)}>{c.label}</button>
      ))}
      <button onClick={props.onDismiss}>都不对，接主文档下</button>
    </div>
  )
}
```

MainDoc 编排（在既有基础上补充）：
```tsx
// 关键片段：提交问题时
async function ask(question: string) {
  const optimistic = { /* 临时答案节点：id=`tmp-${Date.now()}`? 用计数器避免随机 */ }
  // v1：建临时节点入 store（parent=mainNodeId），streaming 状态，chunk 累积进其 ai_response（纯文本→plainTextToProseMirror）
  // onDone: 用后端返回 node 覆盖临时节点
  // onRoute: setRouteUi(decideRouteUi(conv, mainNodeId))
}
// 接受迁移：
async function accept(c) {
  await api.migrate(answerNodeId, { target: c.target, newParentId: c.refId!, seedText: lastQuestion })
  // 更新 store：改该节点 parent，openSubdocTab(answerNodeId) 若目标是分支/子文档
  setRouteUi({ action: 'none' })
}
```
> 临时节点 id 不用随机（Global Constraint 禁 Math.random 语义一致性）。在 `answer-flow.ts` 顶部用一个模块级自增计数器实现 `nextTempId(): string`（`let __n = 0; export const nextTempId = () => \`tmp-${++__n}\``），不改 store 接口。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/flow/answer-flow.test.ts src/components/RoutePrompt.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/RoutePrompt.tsx packages/web/src/flow/answer-flow.ts packages/web/src/components/MainDoc.tsx packages/web/src/flow/answer-flow.test.ts packages/web/src/components/RoutePrompt.test.tsx
git commit -m "feat: route convergence UI with migration prompt and candidate panel"
```

---

### Task 38: 合并 UI（子文档 → 父节点）

**Files:**
- Create: `packages/web/src/components/MergeButton.tsx`
- Modify: `packages/web/src/components/SubdocTabs.tsx`
- Test: `packages/web/src/components/MergeButton.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `useWorkbench`
- Produces: `<MergeButton sourceNodeId targetNodeId />` — 点击调 `api.merge(source, target)`，成功后调 `onMerged?()`（默认在按钮上显示"已合并"）。SubdocTabs 的 tab-body 增加该按钮（target = 该子文档的 parent_id）。

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/MergeButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MergeButton } from './MergeButton'
import { ApiProvider } from '../api/context'

describe('MergeButton', () => {
  it('calls api.merge with source and target', async () => {
    const api = { merge: vi.fn(async () => ({ merge: { id: 'm1' }, segment: { id: 's1' } })) } as any
    render(<ApiProvider api={api}><MergeButton sourceNodeId="child" targetNodeId="root" /></ApiProvider>)
    fireEvent.click(screen.getByText('合并回父节点'))
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith('child', 'root'))
    await waitFor(() => expect(screen.getByText('已合并')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/MergeButton.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/components/MergeButton.tsx`:
```tsx
import { useState } from 'react'
import { useApi } from '../api/context'

export function MergeButton(props: { sourceNodeId: string; targetNodeId: string; onMerged?: () => void }) {
  const api = useApi()
  const [merged, setMerged] = useState(false)
  const [busy, setBusy] = useState(false)
  if (merged) return <span>已合并</span>
  return (
    <button disabled={busy} onClick={async () => {
      setBusy(true)
      await api.merge(props.sourceNodeId, props.targetNodeId)
      setMerged(true); setBusy(false); props.onMerged?.()
    }}>合并回父节点</button>
  )
}
```

在 `SubdocTabs.tsx` 的 tab-body 中，为 current tab 渲染 `<MergeButton sourceNodeId={current} targetNodeId={nodesById[current]?.parent_id!} />`（parent 存在时）。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/components/MergeButton.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/MergeButton.tsx packages/web/src/components/SubdocTabs.tsx packages/web/src/components/MergeButton.test.tsx
git commit -m "feat: merge button in subdoc tabs"
```

---

### Task 39: 版本历史面板 + 回收站面板

**Files:**
- Create: `packages/web/src/components/VersionPanel.tsx`
- Create: `packages/web/src/components/TrashPanel.tsx`
- Test: `packages/web/src/components/VersionPanel.test.tsx`
- Test: `packages/web/src/components/TrashPanel.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `useWorkbench`
- Produces:
  - `<VersionPanel nodeId />` — 挂载时 `api.listVersions(nodeId)`，列出版本（version_no + change_kind），每条"回退"按钮调 `api.revert` 后 `upsertNode`
  - `<TrashPanel treeId />` — `api.getTrash(treeId)` 列已删节点，"恢复"按钮调 `api.restoreNode` 后从列表移除

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/VersionPanel.test.tsx
import { describe, it, expect, vi, waitFor } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VersionPanel } from './VersionPanel'
import { ApiProvider } from '../api/context'

describe('VersionPanel', () => {
  it('lists versions and reverts', async () => {
    const api = {
      listVersions: vi.fn(async () => ({ versions: [
        { id: 'v1', node_id: 'n', version_no: 1, user_input: null, ai_response: null, change_kind: 'edit', created_at: '' },
        { id: 'v2', node_id: 'n', version_no: 2, user_input: null, ai_response: null, change_kind: 'merge', created_at: '' },
      ] })),
      revert: vi.fn(async () => ({ node: { id: 'n' } })),
    } as any
    render(<ApiProvider api={api}><VersionPanel nodeId="n" /></ApiProvider>)
    await waitFor(() => expect(screen.getByText(/v1/)).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('回退')[0])
    await waitFor(() => expect(api.revert).toHaveBeenCalledWith('n', 1))
  })
})
```

```tsx
// packages/web/src/components/TrashPanel.test.tsx
import { describe, it, expect, vi, waitFor } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrashPanel } from './TrashPanel'
import { ApiProvider } from '../api/context'

describe('TrashPanel', () => {
  it('lists deleted nodes and restores', async () => {
    const api = {
      getTrash: vi.fn(async () => ({ nodes: [
        { id: 'd1', tree_id: 't', parent_id: 'root', sort_order: 0, user_input: '被删的问题',
          ai_response: null, status: 'complete', is_deleted: 1, model_override: null, created_at: '', updated_at: '' },
      ] })),
      restoreNode: vi.fn(async () => ({ ok: true })),
    } as any
    render(<ApiProvider api={api}><TrashPanel treeId="t" /></ApiProvider>)
    await waitFor(() => expect(screen.getByText('被删的问题')).toBeInTheDocument())
    fireEvent.click(screen.getByText('恢复'))
    await waitFor(() => expect(api.restoreNode).toHaveBeenCalledWith('d1'))
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/VersionPanel.test.tsx src/components/TrashPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/components/VersionPanel.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import type { NodeVersionRow } from '@vibe/shared'

export function VersionPanel({ nodeId }: { nodeId: string }) {
  const api = useApi()
  const upsertNode = useWorkbench((s) => s.upsertNode)
  const [versions, setVersions] = useState<NodeVersionRow[]>([])
  useEffect(() => { api.listVersions(nodeId).then((r) => setVersions(r.versions)) }, [nodeId, api])
  return (
    <ul className="version-panel">
      {versions.map((v) => (
        <li key={v.id}>
          <span>v{v.version_no}（{v.change_kind}）</span>
          <button onClick={async () => { const r = await api.revert(nodeId, v.version_no); upsertNode(r.node) }}>回退</button>
        </li>
      ))}
    </ul>
  )
}
```

`packages/web/src/components/TrashPanel.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { NodeRow } from '@vibe/shared'

export function TrashPanel({ treeId }: { treeId: string }) {
  const api = useApi()
  const [nodes, setNodes] = useState<NodeRow[]>([])
  useEffect(() => { api.getTrash(treeId).then((r) => setNodes(r.nodes)) }, [treeId, api])
  return (
    <ul className="trash-panel">
      {nodes.map((n) => (
        <li key={n.id}>
          <span>{(n.user_input ?? '').split('\n')[0] || '未命名'}</span>
          <button onClick={async () => { await api.restoreNode(n.id); setNodes((cur) => cur.filter((x) => x.id !== n.id)) }}>恢复</button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test src/components/VersionPanel.test.tsx src/components/TrashPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/VersionPanel.tsx packages/web/src/components/TrashPanel.tsx packages/web/src/components/VersionPanel.test.tsx packages/web/src/components/TrashPanel.test.tsx
git commit -m "feat: version history and trash panels"
```

---

### Task 40: 应用引导（建/开树，装配全局）+ 端到端冒烟

**Files:**
- Create: `packages/web/src/components/TreeLauncher.tsx`
- Modify: `packages/web/src/App.tsx`
- Create: `packages/web/src/App.smoke.test.tsx`
- Test: `packages/web/src/components/TreeLauncher.test.tsx`

**Interfaces:**
- Consumes: `useApi`, `useWorkbench`
- Produces:
  - `<TreeLauncher/>` — 输入标题"新建树"→ `api.createTree` → `loadTree({ treeId, rootNodeId, nodes: [rootNode] })`；列出已有树点击 → `api.getTree` → `loadTree`
  - `App.tsx`：`<ApiProvider api={createApi()}>` 包 `<Workbench/>`，Workbench 顶部（tree-panel）含 `<TreeLauncher/>`
  - 冒烟测试：用注入的 fake api 走"建树 → 主文档渲染根节点空态"路径

- [ ] **Step 1: 写失败测试**

```tsx
// packages/web/src/components/TreeLauncher.test.tsx
import { describe, it, expect, vi, waitFor, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TreeLauncher } from './TreeLauncher'
import { ApiProvider } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import { plainTextToProseMirror } from '@vibe/shared'

describe('TreeLauncher', () => {
  beforeEach(() => useWorkbench.getState().reset())
  it('creates a tree and loads it into the store', async () => {
    const api = {
      listTrees: vi.fn(async () => ({ trees: [] })),
      createTree: vi.fn(async () => ({
        tree: { id: 't1', title: '缓存', root_node_id: 'root', created_at: '', updated_at: '' },
        rootNode: { id: 'root', tree_id: 't1', parent_id: null, sort_order: 0, user_input: null,
          ai_response: plainTextToProseMirror('欢迎'), status: 'complete', is_deleted: 0, model_override: null, created_at: '', updated_at: '' },
      })),
    } as any
    render(<ApiProvider api={api}><TreeLauncher /></ApiProvider>)
    fireEvent.change(screen.getByLabelText('new-tree-title'), { target: { value: '缓存' } })
    fireEvent.click(screen.getByText('新建树'))
    await waitFor(() => {
      expect(api.createTree).toHaveBeenCalledWith('缓存')
      expect(useWorkbench.getState().mainNodeId).toBe('root')
    })
  })
})
```

```tsx
// packages/web/src/App.smoke.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App smoke', () => {
  it('mounts workbench with launcher', () => {
    render(<App />)
    expect(screen.getByTestId('workbench')).toBeInTheDocument()
    expect(screen.getByLabelText('new-tree-title')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/web test src/components/TreeLauncher.test.tsx src/App.smoke.test.tsx`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/web/src/components/TreeLauncher.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import { useWorkbench } from '../state/workbench-store'
import type { TreeRow } from '@vibe/shared'

export function TreeLauncher() {
  const api = useApi()
  const loadTree = useWorkbench((s) => s.loadTree)
  const [title, setTitle] = useState('')
  const [trees, setTrees] = useState<TreeRow[]>([])
  useEffect(() => { api.listTrees().then((r) => setTrees(r.trees)) }, [api])

  async function create() {
    if (!title.trim()) return
    const { tree, rootNode } = await api.createTree(title)
    loadTree({ treeId: tree.id, rootNodeId: rootNode.id, nodes: [rootNode] })
    setTitle('')
    setTrees((cur) => [tree, ...cur])
  }
  async function open(id: string) {
    const { tree, nodes } = await api.getTree(id)
    loadTree({ treeId: tree.id, rootNodeId: tree.root_node_id!, nodes })
  }
  return (
    <div className="tree-launcher">
      <input aria-label="new-tree-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="新树标题" />
      <button onClick={create}>新建树</button>
      <ul>{trees.map((t) => <li key={t.id}><button onClick={() => open(t.id)}>{t.title}</button></li>)}</ul>
    </div>
  )
}
```

`packages/web/src/App.tsx`:
```tsx
import { ApiProvider } from './api/context'
import { createApi } from './api/client'
import { Workbench } from './components/Workbench'

const api = createApi()

export function App() {
  return (
    <ApiProvider api={api}>
      <Workbench />
    </ApiProvider>
  )
}
```

在 `Workbench.tsx` tree-panel 内，`<h1>` 之后渲染 `<TreeLauncher/>` 和 `<TreePanel/>`。

> 更新既有可能受影响的测试：`App.test.tsx`（Task 3）此时渲染 Workbench，断言改为 `getByTestId('workbench')`；若之前已在 Task 29 调整则无需重复。确保 `App.test.tsx` 与 `App.smoke.test.tsx` 不冲突（可删除旧的 App.test.tsx 断言标题，统一用 smoke）。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/web test`
Expected: PASS（全部前端测试）

- [ ] **Step 5: 全量校验并提交**

```bash
pnpm -r typecheck && pnpm -r test
git add packages/web/src/components/TreeLauncher.tsx packages/web/src/App.tsx packages/web/src/components/TreeLauncher.test.tsx packages/web/src/App.smoke.test.tsx packages/web/src/components/Workbench.tsx
git commit -m "feat: tree launcher and app bootstrap; v1 feature-complete"
```

---

### Task 41: 全局 Provider 配置端点（设置页后端）

**Files:**
- Create: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/routes/settings.test.ts`

**Interfaces:**
- Consumes: `SettingsRepo`
- Produces:
  - `GET /api/settings → { provider, model, hasApiKey: boolean, baseUrl }`（**不回传明文 apiKey**，只回 `hasApiKey` 布尔）
  - `PUT /api/settings { provider?, model?, apiKey?, baseUrl? } → { provider, model, hasApiKey, baseUrl }`（逐键 `settings.set`，key 前缀 `provider.*`）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/src/routes/settings.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'

describe('settings routes', () => {
  it('reads defaults and updates provider config without leaking key', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const a = buildApp(deps)
    const def = await a.inject({ method: 'GET', url: '/api/settings' })
    expect(def.json().provider).toBe('codex')
    expect(def.json().hasApiKey).toBe(false)

    const put = await a.inject({
      method: 'PUT', url: '/api/settings',
      payload: { model: 'gpt-x', apiKey: 'secret' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().model).toBe('gpt-x')
    expect(put.json().hasApiKey).toBe(true)
    expect(JSON.stringify(put.json())).not.toContain('secret')
    await a.close()
  })
})
```

- [ ] **Step 2: 验证失败**

Run: `pnpm --filter @vibe/server test src/routes/settings.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`packages/server/src/routes/settings.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

function view(app: FastifyInstance) {
  const c = app.deps.settings.getProviderConfig()
  return { provider: c.provider, model: c.model, hasApiKey: !!c.apiKey, baseUrl: c.baseUrl }
}

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings', async () => view(app))
  app.put('/api/settings', async (req, reply) => {
    const body = z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
    }).safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid body' })
    const map: Record<string, string | undefined> = {
      'provider.name': body.data.provider,
      'provider.model': body.data.model,
      'provider.apiKey': body.data.apiKey,
      'provider.baseUrl': body.data.baseUrl,
    }
    for (const [k, v] of Object.entries(map)) if (v !== undefined) app.deps.settings.set(k, v)
    return view(app)
  })
}
```

在 `app.ts` 注册 `registerSettingsRoutes(app)`。

- [ ] **Step 4: 验证通过**

Run: `pnpm --filter @vibe/server test src/routes/settings.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/settings.ts packages/server/src/app.ts packages/server/src/routes/settings.test.ts
git commit -m "feat: global provider settings endpoints"
```

---

## 收尾说明

- **真实 Provider/Router 联调**：`CodexProvider` 与 `createLlmRouter` 的真实网络路径不在自动化测试内（依赖外部 API）。在 `packages/server/src/index.ts` 里用 `resolveProvider` + `createLlmRouter` 接上真实实例，并把 `deps.routerOverride` 设为真实 router。配置通过 `settings` 表读写（Task 41 提供端点）。
- **手动冒烟**：`pnpm --filter @vibe/server dev` + `pnpm --filter @vibe/web dev`，浏览器建树 → 提问（真 Codex）→ 划线批注 → 就此展开 → 聚焦子文档 → 合并回父 → 查看版本/回退。
- **v2 起点**：合并的"多落点逐条确认"、多文档 AI 聚合、`ancestor-summary` 组装策略，均在现有 ContextSegment/merge 抽象上扩展，无需改数据模型。
