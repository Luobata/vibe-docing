import { useEffect, useState } from 'react'
import { useApi } from '../api/context'
import type { SettingsPatch, SettingsView } from '../api/types'

export function SettingsPanel() {
  const api = useApi()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [projectRoot, setProjectRoot] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void api.getSettings()
      .then((settings) => {
        if (!active) return
        setHasApiKey(settings.hasApiKey)
        setProjectRoot(settings.projectRoot ?? '')
        setProvider(settings.provider)
        setModel(settings.model)
        setBaseUrl(settings.baseUrl ?? '')
      })
      .catch(() => { if (active) setError('设置加载失败。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api])

  async function save(): Promise<void> {
    setBusy(true)
    setStatus(null)
    setError(null)
    const patch: SettingsPatch = {
      projectRoot,
      provider,
      model,
      baseUrl,
    }
    if (apiKey) patch.apiKey = apiKey
    try {
      const settings: SettingsView = await api.updateSettings(patch)
      setHasApiKey(settings.hasApiKey)
      setApiKey('')
      setStatus('已保存')
    } catch {
      setError('保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p aria-live="polite">正在加载设置…</p>
  return (
    <div className="version-panel">
      <label>
        <span>项目根目录</span>
        <input
          aria-label="项目根目录"
          disabled={busy}
          onChange={(event) => setProjectRoot(event.target.value)}
          placeholder="/absolute/path/to/project"
          value={projectRoot}
        />
      </label>
      <label>
        <span>Provider</span>
        <input aria-label="Provider" disabled={busy} onChange={(event) => setProvider(event.target.value)} value={provider} />
      </label>
      <label>
        <span>Model</span>
        <input aria-label="Model" disabled={busy} onChange={(event) => setModel(event.target.value)} value={model} />
      </label>
      <label>
        <span>Base URL</span>
        <input aria-label="Base URL" disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} value={baseUrl} />
      </label>
      <label>
        <span>API Key</span>
        <input
          aria-label="API Key"
          disabled={busy}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={hasApiKey ? '已设置（留空保持不变）' : '未设置'}
          type="password"
          value={apiKey}
        />
      </label>
      <button className="primary-button" disabled={busy} onClick={() => { void save() }} type="button">保存</button>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
