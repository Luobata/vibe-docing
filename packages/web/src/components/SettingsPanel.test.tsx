import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  it('chooses the local notebook folder with the native picker', async () => {
    const pickDirectory = vi.fn(async () => ({ path: '/Users/me/Notes' }))
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: null, provider: 'openai', vaultPath: null,
      })),
      pickDirectory,
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)

    const input = await screen.findByLabelText('Obsidian Vault 文件夹')
    fireEvent.click(screen.getAllByRole('button', { name: '浏览…' })[0])
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledWith('vault'))
    expect(input).toHaveValue('/Users/me/Notes')
  })

  it('prefills settings, prevents duplicate saves, and shows saving and success feedback', async () => {
    let finishSave: ((settings: {
      baseUrl: string | null
      hasApiKey: boolean
      model: string
      projectRoot: string | null
      provider: string
    }) => void) | undefined
    const updateSettings = vi.fn(() => new Promise((resolve) => {
      finishSave = resolve
    }))
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: '/root', provider: 'openai',
      })),
      updateSettings,
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)

    const input = (await screen.findByLabelText('项目代码目录')) as HTMLInputElement
    expect(input.value).toBe('/root')

    fireEvent.change(input, { target: { value: '/proj' } })
    const saveButton = screen.getByRole('button', { name: '保存设置' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: '/proj' }),
        expect.any(AbortSignal),
      ),
    )
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在保存设置…')

    await act(async () => {
      finishSave?.({
        baseUrl: null,
        hasApiKey: false,
        model: 'alwaysday1_max',
        projectRoot: '/proj',
        provider: 'codex',
      })
    })

    expect(await screen.findByRole('status')).toHaveTextContent('设置已保存。')
    expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
    expect(screen.getByLabelText('模型名称')).toHaveValue('alwaysday1_max')
  })

  it('recovers the form and explains when saving times out', async () => {
    const api = {
      getSettings: vi.fn(async () => ({
        baseUrl: null,
        hasApiKey: false,
        model: 'alwaysday1_max',
        projectRoot: '/root',
        provider: 'codex',
      })),
      updateSettings: vi.fn(() => new Promise(() => {})),
    }
    render(<ApiProvider api={api as never}><SettingsPanel /></ApiProvider>)
    await screen.findByLabelText('模型名称')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(screen.getByRole('alert')).toHaveTextContent('保存超时')
      expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
      expect(screen.getByLabelText('模型名称')).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
