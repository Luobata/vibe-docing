import type { DecoratedApp } from '../app'
import { buildAnthropicRequest } from '../provider/anthropic-provider'

interface SettingsUpdate {
  apiKey?: string
  baseUrl?: string
  model?: string
  projectRoot?: string
  provider?: string
  vaultPath?: string
}

const allowedKeys = new Set(['apiKey', 'baseUrl', 'model', 'projectRoot', 'provider', 'vaultPath'])

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
    ...app.deps.settings.getProviderSources(),
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    projectRoot: app.deps.settings.getProjectRoot(),
    provider: config.provider,
    vaultPath: app.deps.settings.getVaultPath() ?? app.deps.vault.root(),
  }
}

export function registerSettingsRoutes(app: DecoratedApp): void {
  app.get('/api/settings', async () => settingsView(app))
  app.post('/api/settings/test', async (request) => {
    const parsed = parseUpdate(request.body)
    const baseUrl = parsed?.baseUrl?.trim().replace(/\/$/, '')
    const model = parsed?.model?.trim()
    if (!baseUrl || !model) return { ok: false, code: 'invalid-config' }
    const config = app.deps.settings.getProviderConfig()
    if (config.provider !== 'codex' && config.provider !== 'anthropic') return { ok: false, code: 'invalid-config' }
    const apiKey = parsed?.apiKey !== undefined
      ? parsed.apiKey
      : config.apiKey
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const started = performance.now()
    try {
      const probe = config.provider === 'anthropic' ? buildAnthropicRequest({
        ...config, baseUrl, model, apiKey,
        apiKeySource: parsed?.apiKey !== undefined ? 'settings' : config.apiKeySource,
      }, [{ role: 'user', content: 'ping' }], { maxTokens: 1, signal: controller.signal }) : {
        url: `${baseUrl}/chat/completions`, init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
          signal: controller.signal,
        },
      }
      const response = await app.deps.providerFetch(probe.url, probe.init)
      // Do not read or forward upstream bodies: even error payloads can echo keys.
      void response.body?.cancel().catch(() => {})
      if (response.ok) return { ok: true, model, latencyMs: Math.round(performance.now() - started) }
      const code = response.status === 401 || response.status === 403 ? 'auth'
        : response.status === 404 ? 'not-found' : 'http-error'
      return { ok: false, code, status: response.status }
    } catch {
      return { ok: false, code: controller.signal.aborted ? 'timeout' : 'unreachable' }
    } finally {
      clearTimeout(timeout)
    }
  })
  app.put('/api/settings', async (request, reply) => {
    const parsed = parseUpdate(request.body)
    if (!parsed || (parsed.provider !== undefined && !['codex', 'anthropic'].includes(parsed.provider))) {
      return reply.code(400).send({ error: 'invalid settings body' })
    }

    const previousProvider = app.deps.settings.getProviderConfig().provider
    const switchingProvider = parsed.provider !== undefined && parsed.provider !== previousProvider
      && ['codex', 'anthropic'].includes(previousProvider)
    const values: Array<[string, string | undefined]> = [
      ['provider.name', parsed.provider],
      ['provider.model', switchingProvider ? '' : parsed.model],
      ['provider.apiKey', switchingProvider ? '' : parsed.apiKey],
      ['provider.baseUrl', switchingProvider ? '' : parsed.baseUrl],
      ['project.root', parsed.projectRoot],
      ['vault.path', parsed.vaultPath],
    ]
    for (const [key, value] of values) {
      if (value !== undefined) app.deps.settings.set(key, value)
    }
    if (parsed.vaultPath !== undefined) app.deps.vault.sync()
    return settingsView(app)
  })
}
