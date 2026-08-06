import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo } from './settings-repo'

describe('SettingsRepo', () => {
  it('returns the default Codex configuration', () => {
    const settings = createSettingsRepo(openMemoryDb())
    expect(settings.getProviderConfig()).toEqual({
      apiKey: null,
      baseUrl: null,
      model: 'gpt-5-codex',
      provider: 'codex',
    })
  })

  it('upserts settings values', () => {
    const settings = createSettingsRepo(openMemoryDb())
    settings.set('provider.model', 'codex-test')
    settings.set('provider.model', 'codex-test-2')
    expect(settings.get('provider.model')).toBe('codex-test-2')
  })
})
