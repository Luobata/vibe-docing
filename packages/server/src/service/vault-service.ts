import { documentContentOf, legacyDocumentToMarkdown, type NodeRow } from '@vibe/shared'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from '../db/connection'
import type { createNodeRepo } from '../repo/node-repo'
import type { createSettingsRepo } from '../repo/settings-repo'
import type { Clock } from '../util/clock'
import { newId } from '../util/ids'

type FileKind = 'markdown' | 'canvas' | 'base'
type Nodes = ReturnType<typeof createNodeRepo>
type Settings = ReturnType<typeof createSettingsRepo>

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const MAX_FILE_BYTES = 2 * 1024 * 1024
const EXTENSIONS: Record<string, FileKind> = { '.base': 'base', '.canvas': 'canvas', '.md': 'markdown' }
const SKIPPED_DIRECTORIES = new Set(['.git', '.obsidian', '.vibe', 'node_modules'])

function hash(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

function portablePath(value: string): string {
  return value.split(sep).join('/')
}

function safeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 96) || 'Untitled'
}

export function createVaultService(options: {
  clock: Clock
  db: Db
  defaultRoot?: string
  nodes: Nodes
  settings: Settings
}) {
  function root(): string {
    const configured = options.settings.getVaultPath() ?? process.env.VIBE_VAULT_PATH
    const absolute = configured
      ? (isAbsolute(configured) ? configured : resolve(projectRoot, configured))
      : (options.defaultRoot ?? resolve(projectRoot, 'vault'))
    mkdirSync(absolute, { recursive: true })
    return resolve(absolute)
  }

  function absolutePath(vaultRoot: string, filePath: string): string {
    const target = resolve(vaultRoot, filePath)
    if (target !== vaultRoot && !target.startsWith(vaultRoot + sep)) {
      throw new Error('vault path escaped its root')
    }
    return target
  }

  function readSource(vaultRoot: string, filePath: string): string | undefined {
    const target = absolutePath(vaultRoot, filePath)
    if (!existsSync(target) || !lstatSync(target).isFile()) return undefined
    const source = readFileSync(target, 'utf8')
    if (Buffer.byteLength(source, 'utf8') > MAX_FILE_BYTES) throw new Error('vault file is too large')
    return source
  }

  function writeSource(vaultRoot: string, filePath: string, source: string): string {
    if (Buffer.byteLength(source, 'utf8') > MAX_FILE_BYTES) throw new Error('vault file is too large')
    const target = absolutePath(vaultRoot, filePath)
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.vibe-${process.pid}-${Date.now()}.tmp`
    writeFileSync(temporary, source, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, target)
    return hash(source)
  }

  function defaultPath(node: NodeRow, kind: FileKind): string {
    const tree = options.db.prepare('SELECT title, root_node_id FROM trees WHERE id = ?').get(node.tree_id) as
      | { root_node_id: string | null; title: string }
      | undefined
    const extension = kind === 'markdown' ? '.md' : `.${kind}`
    const base = safeName(tree?.title ?? node.user_input ?? 'Untitled')
    const preferred = tree?.root_node_id === node.id
      ? `${base}${extension}`
      : `Vibe Derived/${base}/${safeName(node.user_input?.split('\n')[0] ?? node.id)}-${node.id.slice(0, 6)}${extension}`
    const occupied = options.db.prepare(
      'SELECT id FROM nodes WHERE vault_root = ? AND file_path = ? AND id != ?',
    ).get(root(), preferred, node.id)
    return occupied ? preferred.replace(extension, `-${node.id.slice(0, 6)}${extension}`) : preferred
  }

  function kindFor(node: NodeRow): FileKind {
    return node.file_kind === 'canvas' || node.file_kind === 'base' ? node.file_kind : 'markdown'
  }

  function ensureNodeFile(node: NodeRow): NodeRow {
    const vaultRoot = node.vault_root || root()
    const kind = kindFor(node)
    const filePath = node.file_path || defaultPath(node, kind)
    const existing = readSource(vaultRoot, filePath)
    if (existing !== undefined) {
      return options.nodes.syncExternalContent({
        content: existing,
        contentHash: hash(existing),
        fileKind: kind,
        id: node.id,
      })
    }
    const source = kind === 'markdown'
      ? legacyDocumentToMarkdown(documentContentOf(node), node.content_schema_version ?? 0)
      : (documentContentOf(node) ?? (kind === 'canvas' ? '{\n  "nodes": [],\n  "edges": []\n}\n' : 'views: []\n'))
    const contentHash = writeSource(vaultRoot, filePath, source)
    let next = options.nodes.syncExternalContent({ content: source, contentHash, fileKind: kind, id: node.id })
    next = options.nodes.setVaultFile({ contentHash, fileKind: kind, filePath, id: next.id, vaultRoot })
    return next
  }

  function hydrateNode(node: NodeRow): NodeRow {
    if (!node.file_path || !node.vault_root) return ensureNodeFile(node)
    const source = readSource(node.vault_root, node.file_path)
    if (source === undefined) return node
    return options.nodes.syncExternalContent({
      content: source,
      contentHash: hash(source),
      fileKind: kindFor(node),
      id: node.id,
    })
  }

  function writeNode(node: NodeRow, source: string, kind: FileKind): NodeRow {
    const vaultRoot = node.vault_root || root()
    const filePath = node.file_path || defaultPath(node, kind)
    const contentHash = writeSource(vaultRoot, filePath, source)
    return options.nodes.setVaultFile({ contentHash, fileKind: kind, filePath, id: node.id, vaultRoot })
  }

  /** 目录名清洗：拆段、去 ./..、剔非法字符、限 6 层。空串 = 库根目录。 */
  function sanitizeDirectory(input: string): string {
    return input
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      .map((segment) => segment.replace(/[^\p{L}\p{N}_\- ]/gu, '').trim())
      .filter((segment) => segment.length > 0)
      .slice(0, 6)
      .join('/')
  }

  /** 把笔记文件移动到指定目录（空串 = 根目录）。碰撞时追加节点短 id 后缀。 */
  function moveNodeFile(node: NodeRow, directory: string): NodeRow {
    const vaultRoot = node.vault_root || root()
    const kind = kindFor(node)
    const currentPath = node.file_path || defaultPath(node, kind)
    const name = basename(currentPath)
    const safeDir = sanitizeDirectory(directory)
    let target = safeDir ? `${safeDir}/${name}` : name
    if (target !== currentPath) {
      const occupied = options.db
        .prepare('SELECT id FROM nodes WHERE vault_root = ? AND file_path = ? AND id != ?')
        .get(vaultRoot, target, node.id)
      if (occupied) {
        const dot = name.lastIndexOf('.')
        const stem = dot > 0 ? name.slice(0, dot) : name
        const extension = dot > 0 ? name.slice(dot) : ''
        const suffixed = `${stem}-${node.id.slice(0, 6)}${extension}`
        target = safeDir ? `${safeDir}/${suffixed}` : suffixed
      }
    }

    let source = readSource(vaultRoot, currentPath)
    if (source === undefined) {
      const materialized = ensureNodeFile(node)
      source = readSource(materialized.vault_root ?? vaultRoot, materialized.file_path ?? currentPath) ?? ''
    }
    if (target === currentPath) return options.nodes.setVaultFile({ contentHash: hash(source), fileKind: kind, filePath: target, id: node.id, vaultRoot })

    writeSource(vaultRoot, target, source)
    try { rmSync(absolutePath(vaultRoot, currentPath)) } catch { /* 旧文件缺失时静默 */ }
    return options.nodes.setVaultFile({ contentHash: hash(source), fileKind: kind, filePath: target, id: node.id, vaultRoot })
  }

  function scanFiles(vaultRoot: string): Array<{ filePath: string; kind: FileKind; source: string }> {
    const files: Array<{ filePath: string; kind: FileKind; source: string }> = []
    const visit = (directory: string, depth: number): void => {
      if (depth > 24) return
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const target = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(target, depth + 1)
          continue
        }
        if (!entry.isFile()) continue
        const kind = EXTENSIONS[extname(entry.name).toLowerCase()]
        if (!kind) continue
        const source = readFileSync(target, 'utf8')
        if (Buffer.byteLength(source, 'utf8') > MAX_FILE_BYTES) continue
        files.push({ filePath: portablePath(relative(vaultRoot, target)), kind, source })
      }
    }
    visit(vaultRoot, 0)
    return files
  }

  function importFile(vaultRoot: string, file: { filePath: string; kind: FileKind; source: string }): boolean {
    const present = options.db.prepare(
      'SELECT id FROM nodes WHERE vault_root = ? AND file_path = ?',
    ).get(vaultRoot, file.filePath) as { id: string } | undefined
    if (present) {
      hydrateNode(options.nodes.get(present.id)!)
      return false
    }

    const contentHash = hash(file.source)
    const renameCandidate = options.db.prepare(
      `SELECT * FROM nodes
       WHERE vault_root = ? AND content_hash = ? AND file_kind = ? AND file_path IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(vaultRoot, contentHash, file.kind) as NodeRow | undefined
    if (renameCandidate && renameCandidate.file_path
      && !existsSync(absolutePath(vaultRoot, renameCandidate.file_path))) {
      options.nodes.setVaultFile({
        contentHash,
        fileKind: file.kind,
        filePath: file.filePath,
        id: renameCandidate.id,
        vaultRoot,
      })
      return false
    }

    const now = options.clock.now()
    const treeId = newId()
    const nodeId = newId()
    const title = file.filePath.slice(0, -extname(file.filePath).length)
    options.db.transaction(() => {
      options.db.prepare(
        `INSERT INTO trees (id, title, root_node_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(treeId, title, nodeId, now, now)
      options.db.prepare(
        `INSERT INTO nodes (
           id, tree_id, parent_id, sort_order, user_input, ai_response, document_content,
           status, is_deleted, model_override, content_revision,
           content_schema_version, content_updated_at, vault_root, file_path,
           file_kind, content_hash, created_at, updated_at
         ) VALUES (?, ?, NULL, 0, NULL, NULL, ?, 'complete', 0, NULL, 1, 2, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(nodeId, treeId, file.source, now, vaultRoot, file.filePath, file.kind, contentHash, now, now)
    })()
    return true
  }

  function sync(): { imported: number; path: string; scanned: number } {
    const vaultRoot = root()
    const files = scanFiles(vaultRoot)
    let imported = 0
    for (const file of files) if (importFile(vaultRoot, file)) imported += 1
    return { imported, path: vaultRoot, scanned: files.length }
  }

  return { ensureNodeFile, hydrateNode, moveNodeFile, root, sync, writeNode }
}
