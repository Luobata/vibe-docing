import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export function resolveProjectRoot(raw: string | null): { root: string } | { error: string } {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { error: '未配置项目根目录' }
  if (!isAbsolute(trimmed)) return { error: '请填写绝对路径' }
  if (!existsSync(trimmed)) return { error: '目录不存在' }
  if (!statSync(trimmed).isDirectory()) return { error: '不是目录' }
  return { root: trimmed }
}
