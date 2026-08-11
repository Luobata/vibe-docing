import { useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context'
import type { SettingsPatch, SettingsView } from '../api/types'

const SETTINGS_REQUEST_TIMEOUT_MS = 10_000

class SettingsRequestTimeoutError extends Error {}

async function withTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new SettingsRequestTimeoutError())
    }, SETTINGS_REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([request(controller.signal), timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export function SettingsPanel() {
  const api = useApi()
  const savingRef = useRef(false)
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
    void withTimeout((signal) => api.getSettings(signal))
      .then((settings) => {
        if (!active) return
        setHasApiKey(settings.hasApiKey)
        setProjectRoot(settings.projectRoot ?? '')
        setProvider(settings.provider)
        setModel(settings.model)
        setBaseUrl(settings.baseUrl ?? '')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof SettingsRequestTimeoutError
          ? '设置加载超时，请检查服务状态后重试。'
          : '设置加载失败。')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api])

  async function save(): Promise<void> {
    if (savingRef.current) return
    savingRef.current = true
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
      const settings: SettingsView = await withTimeout(
        (signal) => api.updateSettings(patch, signal),
      )
      setHasApiKey(settings.hasApiKey)
      setProjectRoot(settings.projectRoot ?? '')
      setProvider(settings.provider)
      setModel(settings.model)
      setBaseUrl(settings.baseUrl ?? '')
      setApiKey('')
      setStatus('设置已保存。')
    } catch (cause: unknown) {
      setError(cause instanceof SettingsRequestTimeoutError
        ? '保存超时，设置未确认写入，请检查服务状态后重试。'
        : '保存失败，请重试。')
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  if (loading) return <p aria-live="polite">正在加载设置…</p>
  return (
    <div className="settings-panel version-panel">
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
      <button
        aria-busy={busy}
        className="primary-button"
        disabled={busy}
        onClick={() => { void save() }}
        type="button"
      >
        {busy ? '保存中…' : '保存'}
      </button>
      {busy && <p className="settings-save-feedback" role="status">正在保存设置…</p>}
      {status && <p className="settings-save-feedback is-success" role="status">{status}</p>}
      {error && <p className="inline-error settings-save-feedback" role="alert">{error}</p>}
    </div>
  )
}
