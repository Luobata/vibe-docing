import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../db/connection'
import { createSettingsRepo } from '../repo/settings-repo'
import { createMockProvider } from './mock-provider'
import { resolveProvider } from './registry'

describe('resolveProvider', () => {
  it('uses an injected provider without reading the network', () => {
    const override = createMockProvider({ chunks: ['offline'] })
    const provider = resolveProvider(
      { settings: createSettingsRepo(openMemoryDb()) },
      override,
    )
    expect(provider).toBe(override)
  })

  it('constructs the configured Codex adapter lazily', () => {
    const settings = createSettingsRepo(openMemoryDb())
    const provider = resolveProvider({ settings })
    expect(provider.stream).toBeTypeOf('function')
    expect(provider.complete).toBeTypeOf('function')
  })
})
