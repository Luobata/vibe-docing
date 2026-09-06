import type { createSettingsRepo } from '../repo/settings-repo'
import { createCodexProvider } from './codex-provider'
import type { Provider } from './types'

type SettingsRepo = ReturnType<typeof createSettingsRepo>

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}

export function resolveProvider(
  deps: { settings: SettingsRepo },
  override?: Provider,
): Provider {
  if (override) return override

  const config = deps.settings.getProviderConfig()
  if (config.provider !== 'codex') {
    throw new ProviderConfigError(`Unsupported provider: ${config.provider}`)
  }
  return createCodexProvider(config)
}
