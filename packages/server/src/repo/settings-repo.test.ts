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

  it('returns the configured project root', () => {
    const settings = createSettingsRepo(openMemoryDb())
    settings.set('project.root', '/tmp/project')
    expect(settings.getProjectRoot()).toBe('/tmp/project')
  })

  it('returns null when the project root is unset', () => {
    const settings = createSettingsRepo(openMemoryDb())
    expect(settings.getProjectRoot()).toBeNull()
  })

  it('returns null when the project root is whitespace only', () => {
    const settings = createSettingsRepo(openMemoryDb())
    settings.set('project.root', '   ')
    expect(settings.getProjectRoot()).toBeNull()
  })
})
