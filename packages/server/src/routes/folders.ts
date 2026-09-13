import type { DecoratedApp } from '../app'
import { sanitizeTreeFolder } from '../util/folder-path'

function folderPath(body: unknown): string {
  const path = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).path
    : undefined
  return typeof path === 'string' ? sanitizeTreeFolder(path) : ''
}

export function registerFolderRoutes(app: DecoratedApp): void {
  app.get('/api/folders', async () => ({ folders: app.deps.trees.listFolders() }))

  app.post('/api/folders', async (request, reply) => {
    const path = folderPath(request.body)
    if (!path) return reply.code(400).send({ error: 'invalid folder path' })
    const { folder, created } = app.deps.trees.createFolder(path)
    return reply.code(created ? 201 : 200).send({ folder })
  })

  app.post('/api/folders/remove', async (request, reply) => {
    const path = folderPath(request.body)
    if (!path) return reply.code(400).send({ error: 'invalid folder path' })
    if (!app.deps.trees.removeFolder(path)) {
      return reply.code(409).send({ error: 'folder is not empty', code: 'FOLDER_NOT_EMPTY' })
    }
    return { ok: true }
  })
}
