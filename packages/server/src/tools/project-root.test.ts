import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveProjectRoot } from './project-root'

let dir: string
let file: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'projroot-'))
  file = join(dir, 'a-file.txt')
  writeFileSync(file, 'hello')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveProjectRoot', () => {
  it('errors on null', () => {
    expect(resolveProjectRoot(null)).toEqual({ error: '未配置项目根目录' })
  })

  it('errors on empty string', () => {
    expect(resolveProjectRoot('')).toEqual({ error: '未配置项目根目录' })
  })

  it('errors on whitespace only', () => {
    expect(resolveProjectRoot('   ')).toEqual({ error: '未配置项目根目录' })
  })

  it('errors on a relative path', () => {
    expect(resolveProjectRoot('relative/path')).toEqual({ error: '请填写绝对路径' })
  })

  it('errors on a nonexistent absolute path', () => {
    expect(resolveProjectRoot(join(dir, 'does-not-exist'))).toEqual({ error: '目录不存在' })
  })

  it('errors when the path is a file, not a directory', () => {
    expect(resolveProjectRoot(file)).toEqual({ error: '不是目录' })
  })

  it('returns the trimmed root for a real directory', () => {
    expect(resolveProjectRoot(`  ${dir}  `)).toEqual({ root: dir })
  })
})
