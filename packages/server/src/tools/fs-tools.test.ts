import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_FILE_BYTES,
  MAX_GREP_HITS,
  TOOL_SCHEMAS,
  dispatchTool,
  findFiles,
  grep,
  isExcluded,
  listDir,
  readFile,
  readLines,
  safeResolve,
} from './fs-tools'

let root: string
let outsideDir: string
const OUTSIDE_SECRET = 'OUTSIDE_TOP_SECRET_VALUE'
let symlinksCreated = false

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fstool-'))
  writeFileSync(join(root, 'pkg.json'), '{"name":"fixture"}')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), "export const x = 'hello'\nconst y = 2\n")
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', 'x.js'), 'module.exports = 1')
  writeFileSync(join(root, '.env'), 'SECRET=1')
  writeFileSync(join(root, '.env.local'), 'SECRET=2')
  writeFileSync(join(root, '.secret'), 'hidden')
  writeFileSync(join(root, 'big.txt'), 'a'.repeat(MAX_FILE_BYTES + 10000))
  writeFileSync(join(root, 'lines.txt'), 'L1\nL2\nL3\nL4\nL5')
  // > MAX_GREP_HITS matching lines for the truncation regression test.
  const manyLines = Array.from({ length: MAX_GREP_HITS + 50 }, () => 'GREPME token').join('\n')
  writeFileSync(join(root, 'many.txt'), manyLines)

  // An OUTSIDE dir (with a secret) plus in-root symlinks pointing at it, to
  // prove the security boundary rejects/skips symlink escapes.
  outsideDir = mkdtempSync(join(tmpdir(), 'fstool-outside-'))
  writeFileSync(join(outsideDir, 'passwd'), OUTSIDE_SECRET)
  try {
    symlinkSync(outsideDir, join(root, 'evil-link'), 'dir')
    symlinkSync(join(outsideDir, 'passwd'), join(root, 'passwd-link'), 'file')
    symlinksCreated = true
  } catch {
    // Some environments lack symlink permissions; skip those tests gracefully.
    symlinksCreated = false
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  if (outsideDir) rmSync(outsideDir, { recursive: true, force: true })
})

describe('constants', () => {
  it('exposes byte and hit caps', () => {
    expect(MAX_FILE_BYTES).toBe(262144)
    expect(MAX_GREP_HITS).toBe(200)
  })
})

describe('safeResolve', () => {
  it('allows a normal child path', () => {
    const resolved = safeResolve(root, 'pkg.json')
    expect(resolved.endsWith('pkg.json')).toBe(true)
  })

  it('rejects ../ escape', () => {
    expect(() => safeResolve(root, '../etc')).toThrow('path escapes project root')
  })

  it('rejects absolute path outside root', () => {
    expect(() => safeResolve(root, '/etc/passwd')).toThrow('path escapes project root')
  })

  it('allows root itself', () => {
    expect(() => safeResolve(root, '.')).not.toThrow()
  })
})

describe('isExcluded', () => {
  it('excludes .git, node_modules, .env, .env.*, dotfiles', () => {
    expect(isExcluded('.git/x')).toBe(true)
    expect(isExcluded('node_modules/a')).toBe(true)
    expect(isExcluded('.env')).toBe(true)
    expect(isExcluded('.env.local')).toBe(true)
    expect(isExcluded('.secret')).toBe(true)
    expect(isExcluded('src/deep/node_modules/a.ts')).toBe(true)
  })

  it('does not exclude normal paths and guards empty', () => {
    expect(isExcluded('src/a.ts')).toBe(false)
    expect(isExcluded('pkg.json')).toBe(false)
    expect(isExcluded('')).toBe(false)
  })
})

describe('readFile', () => {
  it('reads a normal file', () => {
    expect(readFile(root, { path: 'pkg.json' })).toBe('{"name":"fixture"}')
  })

  it('rejects files over the byte cap', () => {
    expect(readFile(root, { path: 'big.txt' })).toBe('错误：文件过大（>256KB）')
  })

  it('rejects excluded files', () => {
    expect(readFile(root, { path: '.env' })).toBe('错误：该文件被排除')
  })

  it('reports missing files', () => {
    expect(readFile(root, { path: 'nope.txt' })).toBe('错误：文件不存在')
  })
})

describe('listDir', () => {
  it('lists entries sorted, marks dirs, and skips excluded', () => {
    const out = listDir(root, {})
    const lines = out.split('\n')
    expect(lines).toContain('pkg.json')
    expect(lines).toContain('[dir] src')
    expect(lines).not.toContain('node_modules')
    expect(lines).not.toContain('[dir] node_modules')
    expect(lines).not.toContain('.env')
    expect(lines).not.toContain('.secret')
    const sorted = [...lines].sort()
    expect(lines).toEqual(sorted)
  })

  it('lists a subdirectory', () => {
    expect(listDir(root, { path: 'src' })).toBe('a.ts')
  })
})

describe('grep', () => {
  it('emits rel:line:text hits', () => {
    const out = grep(root, { pattern: 'hello' })
    expect(out).toContain('src/a.ts:1:')
    expect(out).toContain("export const x = 'hello'")
  })

  it('returns empty string when nothing matches', () => {
    expect(grep(root, { pattern: 'zzz-no-match-zzz' })).toBe('')
  })

  it('truncates at MAX_GREP_HITS matches', () => {
    const out = grep(root, { pattern: 'GREPME' })
    const lines = out.split('\n')
    // 200 hit lines + 1 truncation marker line.
    const hitLines = lines.filter((l) => l.includes('GREPME'))
    expect(hitLines).toHaveLength(MAX_GREP_HITS)
    expect(out).toContain('（已截断')
  })
})

describe('findFiles', () => {
  it('matches **/*.ts and excludes node_modules', () => {
    const out = findFiles(root, { glob: '**/*.ts' })
    const lines = out.split('\n')
    expect(lines).toContain('src/a.ts')
    expect(out).not.toContain('node_modules')
  })
})

describe('readLines', () => {
  it('returns a numbered range', () => {
    expect(readLines(root, { path: 'lines.txt', start: 2, end: 4 })).toBe('2: L2\n3: L3\n4: L4')
  })

  it('clamps out-of-range bounds', () => {
    expect(readLines(root, { path: 'lines.txt', start: 0, end: 999 })).toBe(
      '1: L1\n2: L2\n3: L3\n4: L4\n5: L5',
    )
  })

  it('rejects excluded files', () => {
    expect(readLines(root, { path: '.env', start: 1, end: 1 })).toBe('错误：该文件被排除')
  })
})

describe('TOOL_SCHEMAS', () => {
  it('describes the five snake_case tools', () => {
    expect(TOOL_SCHEMAS).toHaveLength(5)
    const names = TOOL_SCHEMAS.map((s) => s.function.name)
    expect(names).toEqual(['list_dir', 'read_file', 'grep', 'find_files', 'read_lines'])
    for (const schema of TOOL_SCHEMAS) {
      expect(schema.type).toBe('function')
      expect(schema.function.parameters.type).toBe('object')
    }
  })
})

describe('dispatchTool', () => {
  it('routes valid calls', () => {
    expect(dispatchTool(root, 'read_file', '{"path":"pkg.json"}')).toBe('{"name":"fixture"}')
  })

  it('reports bad JSON', () => {
    expect(dispatchTool(root, 'read_file', 'not json')).toBe('错误：参数解析失败')
  })

  it('reports unknown tools', () => {
    expect(dispatchTool(root, 'nope', '{}')).toBe('错误：未知工具 nope')
  })

  it('reports path escapes as boundary errors', () => {
    expect(dispatchTool(root, 'read_file', '{"path":"../../../etc/passwd"}')).toBe('错误：路径越界')
  })
})

describe('symlink escape (security invariant)', () => {
  it('rejects reading a symlinked file that points outside root', () => {
    if (!symlinksCreated) return
    expect(dispatchTool(root, 'read_file', '{"path":"passwd-link"}')).toBe('错误：路径越界')
  })

  it('does not surface outside secret content via listDir/findFiles/grep', () => {
    if (!symlinksCreated) return
    // The symlinked dir/file are skipped by the walk; the secret never appears.
    expect(listDir(root, {})).not.toContain(OUTSIDE_SECRET)
    expect(findFiles(root, { glob: '**/*' })).not.toContain(OUTSIDE_SECRET)
    expect(grep(root, { pattern: OUTSIDE_SECRET })).not.toContain(OUTSIDE_SECRET)
    expect(grep(root, { pattern: 'OUTSIDE' })).toBe('')
  })
})
