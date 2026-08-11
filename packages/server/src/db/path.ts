import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/**
 * Canonical local database containing the project's long-lived document history.
 * Keep this aligned with DATABASE.md and never replace it with a cwd-local vibe.db.
 */
export const DEFAULT_DATABASE_RELATIVE_PATH = 'vibe-local.db'

/** Resolve relative DB_PATH values from the repository root, never process.cwd(). */
export function resolveDatabasePath(configuredPath = process.env.DB_PATH): string {
  const value = configuredPath?.trim()
  if (value === ':memory:') return value
  return value
    ? resolve(projectRoot, value)
    : resolve(projectRoot, DEFAULT_DATABASE_RELATIVE_PATH)
}

export function ensureDatabaseDirectory(databasePath: string): string {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
  return databasePath
}
