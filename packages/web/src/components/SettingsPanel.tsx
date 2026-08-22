import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
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
  const [vaultPath, setVaultPath] = useState('')
  const [picking, setPicking] = useState<'vault' | 'project' | null>(null)

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
        setVaultPath(settings.vaultPath ?? '')
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
      vaultPath,
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
      setVaultPath(settings.vaultPath ?? '')
      setApiKey('')
      const syncVault = (api as Partial<typeof api>).syncVault
      if (syncVault) {
        const result = await syncVault()
        window.dispatchEvent(new CustomEvent('vibe:vault-synced'))
        setStatus(`本地笔记已同步：扫描 ${result.scanned} 个文件，新增 ${result.imported} 个。`)
      } else {
        setStatus('设置已保存。')
      }
    } catch (cause: unknown) {
      setError(cause instanceof SettingsRequestTimeoutError
        ? '保存超时，设置未确认写入，请检查服务状态后重试。'
        : '保存失败，请重试。')
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  async function pickDirectory(kind: 'vault' | 'project'): Promise<void> {
    if (picking || busy) return
    setPicking(kind)
    setError(null)
    try {
      const result = await api.pickDirectory(kind)
      if (kind === 'vault') setVaultPath(result.path)
      else setProjectRoot(result.path)
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 409)) {
        setError('系统文件夹选择器不可用，请手动粘贴完整路径。')
      }
    } finally {
      setPicking(null)
    }
  }

  if (loading) return <p aria-live="polite">正在加载设置…</p>
  return (
    <div className="settings-panel version-panel">
      <header className="settings-panel-heading">
        <div>
          <strong>设置</strong>
          <p>笔记默认保存在本机。不了解 AI 参数时，保持高级设置不变即可。</p>
        </div>
      </header>
      <section aria-labelledby="local-notes-settings" className="settings-section">
        <h3 id="local-notes-settings">本地笔记目录</h3>
        <p>Vault 是 Obsidian 存放笔记的本地文件夹。选择已有 Vault 后，普通笔记（Markdown 文本文件）和画布（Canvas 文件）可在两个应用间继续编辑；留空时仍可使用当前本地数据库。</p>
        <label>
          <span>Obsidian Vault 文件夹</span>
          <span className="settings-path-control">
            <input
              aria-label="Obsidian Vault 文件夹"
              disabled={busy || picking !== null}
              onChange={(event) => setVaultPath(event.target.value)}
              placeholder="例如 /Users/me/Documents/My Vault"
              value={vaultPath}
            />
            <button disabled={busy || picking !== null} onClick={() => { void pickDirectory('vault') }} type="button">{picking === 'vault' ? '选择中…' : '浏览…'}</button>
          </span>
        </label>
      </section>
      <details className="settings-advanced">
        <summary>AI 与项目设置（高级）</summary>
        <div className="settings-advanced-content">
          <p>仅在需要让 AI 读取代码项目，或切换模型服务时修改。</p>
          <label>
            <span>项目代码目录</span>
            <span className="settings-path-control">
              <input
                aria-label="项目代码目录"
                disabled={busy || picking !== null}
                onChange={(event) => setProjectRoot(event.target.value)}
                placeholder="例如 /Users/me/Projects/my-app"
                value={projectRoot}
              />
              <button disabled={busy || picking !== null} onClick={() => { void pickDirectory('project') }} type="button">{picking === 'project' ? '选择中…' : '浏览…'}</button>
            </span>
          </label>
          <label>
            <span>AI 服务商</span>
            <input aria-label="AI 服务商" disabled={busy} onChange={(event) => setProvider(event.target.value)} value={provider} />
          </label>
          <label>
            <span>模型名称</span>
            <input aria-label="模型名称" disabled={busy} onChange={(event) => setModel(event.target.value)} value={model} />
          </label>
          <label>
            <span>服务地址</span>
            <input aria-label="服务地址" disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} value={baseUrl} />
          </label>
          <label>
            <span>API 密钥</span>
            <input
              aria-label="API 密钥"
              disabled={busy}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasApiKey ? '已设置（留空保持不变）' : '未设置'}
              type="password"
              value={apiKey}
            />
          </label>
        </div>
      </details>
      <div className="settings-actions">
        <button
          aria-busy={busy}
          className="primary-button"
          disabled={busy}
          onClick={() => { void save() }}
          type="button"
        >
          {busy ? '保存中…' : '保存设置'}
        </button>
      </div>
      {busy && <p className="settings-save-feedback" role="status">正在保存设置…</p>}
      {status && <p className="settings-save-feedback is-success" role="status">{status}</p>}
      {error && <p className="inline-error settings-save-feedback" role="alert">{error}</p>}
    </div>
  )
}
