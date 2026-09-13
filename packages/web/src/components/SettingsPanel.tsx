import { useEffect, useRef, useState } from 'react'
import { ApiError, type ProviderSettingsView, type ProviderTestResult } from '../api/client'
import { useApi } from '../api/context'
import type { SettingsPatch } from '../api/types'

const SETTINGS_REQUEST_TIMEOUT_MS = 10_000
function defaultBaseUrl(provider: string): string {
  return provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
}
const TEST_ERROR_MESSAGES = {
  'invalid-config': '请填写服务地址和模型名称。',
  unreachable: '无法连接服务，请检查地址和网络。',
  timeout: '连接超时，请稍后重试。',
  auth: '认证失败，请检查 API 密钥。',
  'not-found': '服务端点或模型不存在，请检查配置。',
  'http-error': '服务返回错误，请稍后重试。',
}

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
  const testingRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [projectRoot, setProjectRoot] = useState('')
  const [provider, setProvider] = useState('codex')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [vaultPath, setVaultPath] = useState('')
  const [picking, setPicking] = useState<'vault' | 'project' | null>(null)
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsView | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void withTimeout((signal) => api.getSettings(signal))
      .then((settings) => {
        if (!active) return
        setProviderSettings(settings)
        setHasApiKey(settings.hasApiKey)
        setProjectRoot(settings.projectRoot ?? '')
        setProvider(settings.provider)
        setModel(settings.model)
        setBaseUrl(settings.baseUrl ?? defaultBaseUrl(settings.provider))
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
      provider: provider === 'anthropic' ? 'anthropic' : 'codex',
      vaultPath,
    }
    // Saving unrelated settings must not pin an unchanged env/default value into the DB.
    if (!providerSettings || model !== providerSettings.model) patch.model = model
    if (!providerSettings || baseUrl !== (providerSettings.baseUrl ?? defaultBaseUrl(providerSettings.provider))) patch.baseUrl = baseUrl
    if (apiKey) patch.apiKey = apiKey
    try {
      const settings = await withTimeout(
        (signal) => api.updateSettings(patch, signal),
      )
      setProviderSettings(settings)
      setHasApiKey(settings.hasApiKey)
      setProjectRoot(settings.projectRoot ?? '')
      setProvider(settings.provider)
      setModel(settings.model)
      setBaseUrl(settings.baseUrl ?? defaultBaseUrl(settings.provider))
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

  async function testConnection(): Promise<void> {
    if (testingRef.current || busy || provider !== providerSettings?.provider) return
    testingRef.current = true
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await withTimeout((signal) => api.testProvider({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey ? { apiKey } : {}),
      }, signal)))
    } catch (cause) {
      setTestResult({ ok: false, code: cause instanceof SettingsRequestTimeoutError ? 'timeout' : 'unreachable' })
    } finally {
      testingRef.current = false
      setTesting(false)
    }
  }

  function sourceBadge(field: 'apiKey' | 'baseUrl' | 'model') {
    const source = providerSettings?.sources?.[field]
    if (!source || provider !== providerSettings?.provider) return null
    const text = source === 'env' ? `来自环境变量 ${providerSettings?.sourceVars[field] ?? ''}`
      : source === 'settings' ? '来自设置' : source === 'default' ? '默认值' : '未配置'
    return <span className="settings-source">{text}</span>
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
            <select aria-label="AI 服务商" disabled={busy || testing} onChange={(event) => { setProvider(event.target.value); setTestResult(null) }} value={provider === 'anthropic' ? 'anthropic' : 'codex'}>
              <option value="codex">OpenAI 兼容 (codex)</option>
              <option value="anthropic">Anthropic 兼容 (anthropic)</option>
            </select>
          </label>
          {provider !== 'codex' && provider !== 'anthropic' && (
            <p className="notice notice-info">当前服务商 "{provider}" 不受支持，保存后将使用 codex</p>
          )}
          {provider !== providerSettings?.provider && (
            <>
              <p className="notice notice-info">切换服务商会清空已保存的服务地址/模型/密钥，环境变量不受影响</p>
              <p className="settings-env-hint">保存服务商后将刷新配置来源，再测试连接。</p>
            </>
          )}
          <label>
            <span className="settings-field-label">模型名称{sourceBadge('model')}</span>
            <input aria-label="模型名称" disabled={busy || testing} onChange={(event) => { setModel(event.target.value); setTestResult(null) }} value={model} />
          </label>
          {provider === providerSettings?.provider && providerSettings?.sourceVars?.model === 'ANTHROPIC_DEFAULT_OPUS_MODEL' && (
            <p className="settings-env-hint">Claude CLI 模型档位映射，请确认模型名</p>
          )}
          <label>
            <span className="settings-field-label">服务地址{sourceBadge('baseUrl')}</span>
            <input aria-label="服务地址" disabled={busy || testing} onChange={(event) => { setBaseUrl(event.target.value); setTestResult(null) }} value={baseUrl} />
          </label>
          <label>
            <span className="settings-field-label">API 密钥{sourceBadge('apiKey')}</span>
            <input
              aria-label="API 密钥"
              disabled={busy || testing}
              onChange={(event) => { setApiKey(event.target.value); setTestResult(null) }}
              placeholder={hasApiKey ? '已设置（留空保持不变）' : '未设置'}
              type="password"
              value={apiKey}
            />
          </label>
          {providerSettings?.sources && Object.values(providerSettings.sources).includes('env') && (
            <p className="settings-env-hint">环境变量在本地服务启动时读取，修改后需重启服务</p>
          )}
          <div className="settings-test-connection">
            <button aria-busy={testing} className="quiet-button" disabled={busy || testing || provider !== providerSettings?.provider} onClick={() => { void testConnection() }} type="button">
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <p className={`settings-test-result${testResult.ok ? ' is-success' : ''}`} role="status">
                {testResult.ok ? `✓ 连接成功 · ${testResult.latencyMs}ms`
                  : `✗ ${TEST_ERROR_MESSAGES[testResult.code] ?? '测试连接失败。'}${testResult.code === 'http-error' && testResult.status ? `（HTTP ${testResult.status}）` : ''}`}
              </p>
            )}
          </div>
        </div>
      </details>
      <div className="settings-actions">
        <button
          aria-busy={busy}
          className="primary-button"
          disabled={busy || testing}
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
