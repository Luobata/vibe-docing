import type { DecoratedApp } from '../app'

interface SettingsUpdate {
  apiKey?: string
  baseUrl?: string
  model?: string
  projectRoot?: string
  provider?: string
}

const allowedKeys = new Set(['apiKey', 'baseUrl', 'model', 'projectRoot', 'provider'])

function parseUpdate(body: unknown): SettingsUpdate | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return undefined
  if (Object.values(record).some((value) => typeof value !== 'string')) return undefined
  return record as SettingsUpdate
}

function settingsView(app: DecoratedApp) {
  const config = app.deps.settings.getProviderConfig()
  return {
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    projectRoot: app.deps.settings.getProjectRoot(),
    provider: config.provider,
  }
}

export function registerSettingsRoutes(app: DecoratedApp): void {
  app.get('/api/settings', async () => settingsView(app))
  app.put('/api/settings', async (request, reply) => {
    const parsed = parseUpdate(request.body)
    if (!parsed) return reply.code(400).send({ error: 'invalid settings body' })

    const values: Array<[string, string | undefined]> = [
      ['provider.name', parsed.provider],
      ['provider.model', parsed.model],
      ['provider.apiKey', parsed.apiKey],
      ['provider.baseUrl', parsed.baseUrl],
      ['project.root', parsed.projectRoot],
    ]
    for (const [key, value] of values) {
      if (value !== undefined) app.deps.settings.set(key, value)
    }
    return settingsView(app)
  })
}
