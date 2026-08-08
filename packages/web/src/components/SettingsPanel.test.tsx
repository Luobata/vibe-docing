import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/context'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  it('prefills project root from getSettings and saves the edited value', async () => {
    const updateSettings = vi.fn(async () => ({
      baseUrl: null, hasApiKey: false, model: 'gpt-4o', projectRoot: '/proj', provider: 'openai',
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
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: '/proj' }),
      ),
    )
  })
})
