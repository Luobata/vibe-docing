import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'
import { buildApp } from '../app'
import { createMockProvider } from '../provider/mock-provider'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('VaultService', () => {
  it('keeps a completed generation when a GET hydrates its unchanged empty file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-vault-'))
    directories.push(root)
    const deps = createDeps({ db: openMemoryDb(), vaultPath: root })
    deps.settings.set('tags.autoGenerate', 'false')
    const app = buildApp(deps)
    try {
      const created = await app.inject({ method: 'POST', url: '/api/trees', payload: { title: 'Generated' } })
      const { rootNode } = created.json()
      const done = await deps.answer.generate({
        nodeId: rootNode.id,
        provider: createMockProvider({ chunks: ['generated', ' content'] }),
        userInput: 'test',
      }, () => {})
      expect(done.document_content).toContain('generated content')
      const path = join(root, done.file_path!)
      // Even a newer mtime must not make our unchanged empty file authoritative.
      const future = new Date(Date.parse(done.content_updated_at!) + 10_000)
      utimesSync(path, future, future)
      for (let index = 0; index < 2; index += 1) {
        const response = await app.inject({ method: 'GET', url: `/api/nodes/${done.id}` })
        expect(response.statusCode).toBe(200)
        expect(response.json().node).toMatchObject({
          document_content: done.document_content,
          content_revision: done.content_revision,
        })
      }
      expect(readFileSync(path, 'utf8')).toBe('')
    } finally {
      await app.close()
      deps.db.close()
    }
  })

  it.each([-1, 0, 1])('imports a changed file only when newer than the DB (offset %i seconds)', (offset) => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-vault-'))
    directories.push(root)
    const updatedAt = '2026-08-12T00:00:00.000Z'
    const deps = createDeps({ clock: fixedClock(updatedAt), db: openMemoryDb(), vaultPath: root })
    try {
      const node = deps.vault.ensureNodeFile(deps.trees.create('External').rootNode)
      const generated = deps.nodes.updateGeneration(node.id, {
        aiResponse: '{"type":"doc","content":[{"type":"text","text":"DB body"}]}', status: 'complete',
      })
      const path = join(root, node.file_path!)
      writeFileSync(path, '# External edit\n')
      const modifiedAt = new Date(Date.parse(updatedAt) + offset * 1000)
      utimesSync(path, modifiedAt, modifiedAt)
      const hydrated = deps.vault.hydrateNode(generated)
      expect(hydrated.document_content).toBe(offset > 0 ? '# External edit\n' : generated.document_content)
      expect(hydrated.content_revision).toBe(generated.content_revision! + (offset > 0 ? 1 : 0))
      expect(deps.vault.hydrateNode(hydrated).content_revision).toBe(hydrated.content_revision)
    } finally {
      deps.db.close()
    }
  })

  it('imports Markdown, Canvas, and Bases while preserving their source', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-vault-'))
    directories.push(root)
    const markdown = '---\ncustom: true # keep\n---\n\n# Note\n\n```plugin\nopaque\n```\n'
    const canvas = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":200,"height":100,"text":"# Card","extension":true}],"edges":[]}'
    const base = 'views:\n  - type: table\n    name: Notes\n'
    writeFileSync(join(root, 'Note.md'), markdown)
    writeFileSync(join(root, 'Board.canvas'), canvas)
    writeFileSync(join(root, 'Notes.base'), base)
    const deps = createDeps({ clock: fixedClock('2026-08-12T00:00:00.000Z'), db: openMemoryDb(), vaultPath: root })

    expect(deps.vault.sync()).toMatchObject({ imported: 3, scanned: 3 })
    const nodes = deps.db.prepare('SELECT * FROM nodes ORDER BY file_path').all() as Array<{ ai_response: string | null; document_content: string; file_kind: string; file_path: string }>
    expect(nodes).toEqual([
      expect.objectContaining({ ai_response: null, document_content: canvas, file_kind: 'canvas', file_path: 'Board.canvas' }),
      expect.objectContaining({ ai_response: null, document_content: markdown, file_kind: 'markdown', file_path: 'Note.md' }),
      expect.objectContaining({ ai_response: null, document_content: base, file_kind: 'base', file_path: 'Notes.base' }),
    ])
    deps.db.close()
  })

  it('materializes legacy content once and then follows external file edits', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-vault-'))
    directories.push(root)
    const deps = createDeps({ clock: fixedClock('2026-08-12T00:00:00.000Z'), db: openMemoryDb(), vaultPath: root })
    const { rootNode } = deps.trees.create('Legacy')
    const legacyContent = JSON.stringify({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Migrated' }] }] })
    deps.nodes.updateContent(rootNode.id, {
      aiResponse: legacyContent,
      documentContent: legacyContent,
      contentSchemaVersion: 1,
    })

    const migrated = deps.vault.ensureNodeFile(deps.nodes.get(rootNode.id)!)
    expect(migrated.file_path).toBe('Legacy.md')
    expect(readFileSync(join(root, 'Legacy.md'), 'utf8')).toBe('## Migrated')
    writeFileSync(join(root, 'Legacy.md'), '# Edited in Obsidian\n')
    const hydrated = deps.vault.hydrateNode(migrated)
    expect(hydrated.document_content).toBe('# Edited in Obsidian\n')
    expect(hydrated.ai_response).toContain('Migrated')
    deps.db.close()
  })
})
