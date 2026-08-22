import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createDeps } from '../deps'
import { fixedClock } from '../util/clock'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('VaultService', () => {
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
