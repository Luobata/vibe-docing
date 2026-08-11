import type { DecoratedApp } from '../app'

export function registerVisualArtifactRoutes(app: DecoratedApp): void {
  app.get('/api/visual-artifacts/:artifactId/:revision', async (request, reply) => {
    const revision = Number(request.params.revision)
    if (!Number.isInteger(revision) || revision < 1) {
      return reply.code(400).send({ error: 'invalid visual artifact revision' })
    }
    const artifact = app.deps.visualArtifacts.get(request.params.artifactId, revision)
    if (!artifact) return reply.code(404).send({ error: 'visual artifact not found' })
    return { artifact }
  })
}
