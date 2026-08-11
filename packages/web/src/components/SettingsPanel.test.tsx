import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
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

    const input = (await screen.findByLabelText('项目根目录')) as HTMLInputElement
    expect(input.value).toBe('/root')

    fireEvent.change(input, { target: { value: '/proj' } })
    const saveButton = screen.getByRole('button', { name: '保存' })
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
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(screen.getByLabelText('Model')).toHaveValue('alwaysday1_max')
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
    await screen.findByLabelText('Model')

    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(screen.getByRole('alert')).toHaveTextContent('保存超时')
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
      expect(screen.getByLabelText('Model')).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
