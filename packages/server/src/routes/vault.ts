import type { DecoratedApp } from '../app'

export function registerVaultRoutes(app: DecoratedApp): void {
  app.get('/api/vault', async () => ({ path: app.deps.vault.root() }))
  app.post('/api/vault/sync', async () => app.deps.vault.sync())
}
