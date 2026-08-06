import type { createSettingsRepo } from '../repo/settings-repo'
import { createCodexProvider } from './codex-provider'
import type { Provider } from './types'

type SettingsRepo = ReturnType<typeof createSettingsRepo>

export function resolveProvider(
  deps: { settings: SettingsRepo },
  override?: Provider,
): Provider {
  if (override) return override

  const config = deps.settings.getProviderConfig()
  if (config.provider !== 'codex') {
    throw new Error(`Unsupported provider: ${config.provider}`)
  }
  return createCodexProvider(config)
}
