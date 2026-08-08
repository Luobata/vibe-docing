import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export const MAX_FILE_BYTES = 262144
export const MAX_GREP_HITS = 200

/**
 * Resolve `p` against `root` and assert the result stays inside `root`.
 * When the resolved path exists, symlinks are resolved via realpathSync so a
 * symlink cannot be used to escape the project root. Throws on any escape.
 */
export function safeResolve(root: string, p: string): string {
  const rootReal = realRoot(root)
  const resolved = resolve(rootReal, p)
  const real = existsSync(resolved) ? realpathSync(resolved) : resolved
  if (real === rootReal || real.startsWith(rootReal + sep)) {
    return real
  }
  throw new Error(PATH_ESCAPE)
}

/** Realpath the root when it exists so symlinked temp dirs compare correctly. */
function realRoot(root: string): string {
  return existsSync(root) ? realpathSync(root) : resolve(root)
}

/**
 * True when any path segment is `.git`, `node_modules`, `.env`, `.env.*`, or
 * any dotfile/dotdir. Empty/`.` segments from clean relative paths are ignored.
 */
export function isExcluded(relPath: string): boolean {
  const segments = relPath.split(sep)
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '.git' || seg === 'node_modules') return true
    if (seg === '.env' || seg.startsWith('.env.')) return true
    if (seg.startsWith('.')) return true
  }
  return false
}

const PATH_ESCAPE = 'path escapes project root'

/**
 * Convert an fs error to an error string. Path-escape throws from safeResolve
 * are re-thrown so dispatchTool can surface them as `错误：路径越界`.
 */
function errStr(err: unknown): string {
  if (err instanceof Error && err.message === PATH_ESCAPE) throw err
  const msg = err instanceof Error ? err.message : String(err)
  return `错误：${msg}`
}

export function listDir(root: string, args: { path?: string }): string {
  try {
    const base = realRoot(root)
    const dir = safeResolve(root, args.path ?? '.')
    const entries = readdirSync(dir, { withFileTypes: true })
    const lines: string[] = []
    for (const entry of entries) {
      const rel = relative(base, resolve(dir, entry.name))
      if (isExcluded(rel)) continue
      lines.push(entry.isDirectory() ? `[dir] ${entry.name}` : entry.name)
    }
    lines.sort()
    return lines.join('\n')
  } catch (err) {
    return errStr(err)
  }
}

export function readFile(root: string, args: { path: string }): string {
  try {
    const abs = safeResolve(root, args.path)
    const rel = relative(realRoot(root), abs)
    if (isExcluded(rel)) return '错误：该文件被排除'
    if (!existsSync(abs)) return '错误：文件不存在'
    const stat = statSync(abs)
    if (stat.size > MAX_FILE_BYTES) return '错误：文件过大（>256KB）'
    return readFileSync(abs, 'utf8')
  } catch (err) {
    return errStr(err)
  }
}

/** Recursively collect relative file paths, skipping excluded segments. */
function walkFiles(base: string, dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = resolve(dir, entry.name)
    const rel = relative(base, abs)
    if (isExcluded(rel)) continue
    if (entry.isDirectory()) {
      walkFiles(base, abs, out)
    } else if (entry.isFile()) {
      out.push(rel)
    }
  }
}

export function grep(root: string, args: { pattern: string; path?: string }): string {
  try {
    const base = realRoot(root)
    const start = safeResolve(root, args.path ?? '.')
    const files: string[] = []
    if (statSync(start).isDirectory()) {
      walkFiles(base, start, files)
    } else {
      files.push(relative(base, start))
    }
    files.sort()
    const hits: string[] = []
    let truncated = false
    for (const rel of files) {
      if (isExcluded(rel)) continue
      let content: string
      try {
        content = readFileSync(resolve(base, rel), 'utf8')
      } catch {
        continue
      }
      const fileLines = content.split('\n')
      for (let i = 0; i < fileLines.length; i++) {
        // Plain substring match avoids ReDoS from attacker-supplied patterns.
        if (fileLines[i].includes(args.pattern)) {
          if (hits.length >= MAX_GREP_HITS) {
            truncated = true
            break
          }
          hits.push(`${rel}:${i + 1}:${fileLines[i]}`)
        }
      }
      if (truncated) break
    }
    if (truncated) hits.push(`（已截断，超过 ${MAX_GREP_HITS} 处匹配）`)
    return hits.join('\n')
  } catch (err) {
    return errStr(err)
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/** Convert a glob (`**`→`.*`, `*`→`[^/]*`) to an anchored full-match regex. */
function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else {
      re += escapeRegex(glob[i])
    }
  }
  return new RegExp(`^${re}$`)
}

export function findFiles(root: string, args: { glob: string }): string {
  try {
    const base = safeResolve(root, '.')
    const files: string[] = []
    walkFiles(base, base, files)
    const pattern = globToRegExp(args.glob)
    const matched = files
      .map((rel) => rel.split(sep).join('/'))
      .filter((rel) => pattern.test(rel))
      .sort()
    return matched.join('\n')
  } catch (err) {
    return errStr(err)
  }
}

export function readLines(
  root: string,
  args: { path: string; start: number; end: number },
): string {
  try {
    const abs = safeResolve(root, args.path)
    const rel = relative(realRoot(root), abs)
    if (isExcluded(rel)) return '错误：该文件被排除'
    if (!existsSync(abs)) return '错误：文件不存在'
    const stat = statSync(abs)
    if (stat.size > MAX_FILE_BYTES) return '错误：文件过大（>256KB）'
    const fileLines = readFileSync(abs, 'utf8').split('\n')
    const start = Math.max(1, Math.floor(args.start))
    const end = Math.min(fileLines.length, Math.floor(args.end))
    const out: string[] = []
    for (let n = start; n <= end; n++) {
      out.push(`${n}: ${fileLines[n - 1]}`)
    }
    return out.join('\n')
  } catch (err) {
    return errStr(err)
  }
}

export const TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_dir',
      description: '列出项目根目录下某个目录的条目（跳过 .git/node_modules/dotfiles）。',
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: '相对项目根的目录路径，默认为根目录。' },
        },
        required: [] as string[],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取项目根目录下某个文本文件的完整内容（超过 256KB 或被排除会拒绝）。',
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: '相对项目根的文件路径。' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep',
      description: '在项目根目录下递归按子串搜索文本行，返回 相对路径:行号:内容。',
      parameters: {
        type: 'object' as const,
        properties: {
          pattern: { type: 'string', description: '要搜索的子串。' },
          path: { type: 'string', description: '搜索起点，默认为根目录。' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_files',
      description: '按 glob 递归查找文件（** 匹配任意层级，* 匹配单段），返回相对路径列表。',
      parameters: {
        type: 'object' as const,
        properties: {
          glob: { type: 'string', description: '例如 **/*.ts。' },
        },
        required: ['glob'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_lines',
      description: '读取文件的指定行区间（1 起始，越界自动裁剪），每行带行号前缀。',
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: '相对项目根的文件路径。' },
          start: { type: 'number', description: '起始行号（1 起始）。' },
          end: { type: 'number', description: '结束行号（含）。' },
        },
        required: ['path', 'start', 'end'],
      },
    },
  },
]

export function dispatchTool(root: string, name: string, argsJson: string): string {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
  } catch {
    return '错误：参数解析失败'
  }
  try {
    switch (name) {
      case 'list_dir':
        return listDir(root, args as { path?: string })
      case 'read_file':
        return readFile(root, args as { path: string })
      case 'grep':
        return grep(root, args as { pattern: string; path?: string })
      case 'find_files':
        return findFiles(root, args as { glob: string })
      case 'read_lines':
        return readLines(root, args as { path: string; start: number; end: number })
      default:
        return `错误：未知工具 ${name}`
    }
  } catch (err) {
    if (err instanceof Error && err.message === PATH_ESCAPE) {
      return '错误：路径越界'
    }
    return errStr(err)
  }
}
