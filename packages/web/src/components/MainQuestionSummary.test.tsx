import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MainQuestionSummary } from './MainQuestionSummary'

const longQuestion = '这是一个需要完整保留的长问题。'.repeat(10)

describe('MainQuestionSummary', () => {
  it('keeps a long question compact until the user expands it', () => {
    render(<MainQuestionSummary contentId="main-question" text={longQuestion} />)

    const text = screen.getByText(longQuestion)
    const toggle = screen.getByRole('button', { name: '展开全文' })
    expect(text).toHaveClass('is-collapsed')
    expect(text).toHaveStyle({ maxHeight: '2.9em' })
    expect(text).toHaveTextContent(longQuestion)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'main-question')

    fireEvent.click(toggle)

    expect(text).toHaveClass('is-expanded')
    expect(text).not.toHaveStyle({ maxHeight: '2.9em' })
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('supports native keyboard activation and restores the compact state', () => {
    render(<MainQuestionSummary text={longQuestion} />)
    const toggle = screen.getByRole('button', { name: '展开全文' })

    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Enter' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起' })).toHaveFocus()

    const collapse = screen.getByRole('button', { name: '收起' })
    fireEvent.keyDown(collapse, { key: ' ' })
    fireEvent.click(collapse)
    expect(screen.getByRole('button', { name: '展开全文' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not render a redundant control for short text', () => {
    render(<MainQuestionSummary text="一句简短的问题。" />)

    expect(screen.getByText('一句简短的问题。')).toHaveTextContent('一句简短的问题。')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('resets to the compact state when the source text changes', () => {
    const { rerender } = render(<MainQuestionSummary text={longQuestion} />)
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }))
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument()

    const nextQuestion = '另一个需要保留的长问题。'.repeat(12)
    rerender(<MainQuestionSummary text={nextQuestion} />)

    expect(screen.getByText(nextQuestion)).toHaveClass('is-collapsed')
    expect(screen.getByRole('button', { name: '展开全文' })).toHaveAttribute('aria-expanded', 'false')
  })
})
