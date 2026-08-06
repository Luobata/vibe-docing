import type { Db } from '../db/connection'

export interface ProviderConfig {
  apiKey: string | null
  baseUrl: string | null
  model: string
  provider: string
}

export function createSettingsRepo(db: Db) {
  function get(key: string): string | undefined {
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value
  }

  function set(key: string, value: string): void {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value)
  }

  function getProviderConfig(): ProviderConfig {
    return {
      apiKey: get('provider.apiKey') ?? null,
      baseUrl: get('provider.baseUrl') ?? null,
      model: get('provider.model') ?? 'gpt-5-codex',
      provider: get('provider.name') ?? 'codex',
    }
  }

  return { get, getProviderConfig, set }
}
