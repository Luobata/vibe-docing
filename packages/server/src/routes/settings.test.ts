import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { createDeps } from '../deps'
import { openMemoryDb } from '../db/connection'
import { fixedClock } from '../util/clock'

describe('settings routes', () => {
  it('reads defaults and updates provider config without leaking the key', async () => {
    const deps = createDeps({ db: openMemoryDb(), clock: fixedClock('2026-08-05T00:00:00.000Z') })
    const app = buildApp(deps)
    const defaults = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(defaults.statusCode).toBe(200)
    expect(defaults.json()).toEqual({ baseUrl: null, hasApiKey: false, model: 'gpt-5-codex', provider: 'codex' })

    const updated = await app.inject({
      method: 'PUT', payload: { apiKey: 'secret', baseUrl: 'https://example.test', model: 'gpt-x', provider: 'custom' },
      url: '/api/settings',
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toEqual({ baseUrl: 'https://example.test', hasApiKey: true, model: 'gpt-x', provider: 'custom' })
    expect(updated.body).not.toContain('secret')
    expect(deps.settings.get('provider.apiKey')).toBe('secret')
    await app.close()
  })

  it('rejects unknown or invalid fields without partial writes', async () => {
    const deps = createDeps({ db: openMemoryDb() })
    const app = buildApp(deps)
    const response = await app.inject({ method: 'PUT', payload: { apiKey: 42, unexpected: 'x' }, url: '/api/settings' })
    expect(response.statusCode).toBe(400)
    expect(deps.settings.get('provider.apiKey')).toBeUndefined()
    await app.close()
  })
})
