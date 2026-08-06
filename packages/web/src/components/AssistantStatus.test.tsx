import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantStatus } from './AssistantStatus'

describe('AssistantStatus', () => {
  it('shows a thinking label before the first token', () => {
    render(<AssistantStatus onStop={() => {}} phase="thinking" />)
    expect(screen.getByTestId('assistant-status')).toHaveTextContent('思考')
  })

  it('shows a replying label while streaming', () => {
    render(<AssistantStatus onStop={() => {}} phase="replying" />)
    expect(screen.getByTestId('assistant-status')).toHaveTextContent('回复')
  })

  it('calls onStop when the stop button is clicked', () => {
    const onStop = vi.fn()
    render(<AssistantStatus onStop={onStop} phase="replying" />)
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onStop).toHaveBeenCalledOnce()
  })
})
