import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo, DEFAULT_PROVIDER_MODEL } from './settings-repo'

describe('SettingsRepo', () => {
  it('returns the default Codex configuration', () => {
    const settings = createSettingsRepo(openMemoryDb())
    expect(settings.getProviderConfig()).toEqual({
      apiKey: null,
      baseUrl: null,
      model: DEFAULT_PROVIDER_MODEL,
      provider: 'codex',
    })
  })

  it.each([
    'experimental_0717',
    'model_api/experimental_0717',
    'experimanetental_0717',
    'model_api/experimanetental_0717',
  ])('migrates the legacy model %s without touching other settings', (legacyModel) => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider.model', legacyModel)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider.name', 'codex')

    const settings = createSettingsRepo(db)

    expect(settings.get('provider.model')).toBe(DEFAULT_PROVIDER_MODEL)
    expect(settings.get('provider.name')).toBe('codex')
  })

  it('preserves a user-selected non-legacy model', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('provider.model', 'custom-model')

    const settings = createSettingsRepo(db)

    expect(settings.getProviderConfig().model).toBe('custom-model')
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
