import { execFile } from 'node:child_process'
import type { DecoratedApp } from '../app'

type DirectoryKind = 'vault' | 'project'

function directoryKind(body: unknown): DirectoryKind | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const kind = (body as { kind?: unknown }).kind
  return kind === 'vault' || kind === 'project' ? kind : undefined
}

export function chooseMacDirectory(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', `POSIX path of (choose folder with prompt "${prompt}")`],
      { timeout: 120_000 },
      (error, stdout) => {
        if (error) { reject(error); return }
        const selected = stdout.trim()
        resolve(selected.length > 1 ? selected.replace(/\/$/, '') : selected)
      },
    )
  })
}

export function registerSystemRoutes(app: DecoratedApp): void {
  app.post('/api/system/pick-directory', async (request, reply) => {
    const kind = directoryKind(request.body)
    if (!kind) return reply.code(400).send({ error: 'invalid directory kind' })
    if (process.platform !== 'darwin') {
      return reply.code(501).send({ error: 'native directory picker is unavailable' })
    }
    try {
      const path = await chooseMacDirectory(kind === 'vault'
        ? '选择 Obsidian 笔记库文件夹'
        : '选择项目代码文件夹')
      if (!path) return reply.code(409).send({ error: 'directory picker cancelled' })
      return { path }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (/cancel|canceled|-128/i.test(message)) {
        return reply.code(409).send({ error: 'directory picker cancelled' })
      }
      return reply.code(500).send({ error: 'directory picker failed' })
    }
  })
}
