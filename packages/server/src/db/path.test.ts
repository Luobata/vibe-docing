import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from './path'

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))

describe('database path', () => {
  it('uses the existing project database by default', () => {
    expect(resolveDatabasePath(undefined)).toBe(resolve(projectRoot, 'vibe-local.db'))
  })

  it('resolves a relative override from the project root', () => {
    expect(resolveDatabasePath('backups/workbench.db')).toBe(resolve(projectRoot, 'backups/workbench.db'))
  })

  it('preserves absolute and in-memory paths', () => {
    expect(resolveDatabasePath('/tmp/workbench.db')).toBe('/tmp/workbench.db')
    expect(resolveDatabasePath(':memory:')).toBe(':memory:')
  })
})
