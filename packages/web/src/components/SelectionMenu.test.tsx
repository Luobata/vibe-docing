import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectionMenu } from './SelectionMenu'

describe('SelectionMenu', () => {
  it('renders two actions and fires onPick', () => {
    const onPick = vi.fn()
    render(<SelectionMenu onClose={() => {}} onPick={onPick} x={10} y={10} />)
    fireEvent.click(screen.getByText('就此展开'))
    expect(onPick).toHaveBeenCalledWith('expand')
    fireEvent.click(screen.getByText('笔记'))
    expect(onPick).toHaveBeenCalledWith('note')
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<SelectionMenu onClose={onClose} onPick={() => {}} x={10} y={10} />)
    const backdrop = container.querySelector('.menu-backdrop')!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape and stops the event from bubbling to global handlers', () => {
    const onClose = vi.fn()
    const globalHandler = vi.fn()
    // Matches Workbench's global listener (document, bubble phase).
    document.addEventListener('keydown', globalHandler)
    render(<SelectionMenu onClose={onClose} onPick={() => {}} x={10} y={10} />)
    // Fire from an element inside the menu, as a real focused target would.
    fireEvent.keyDown(screen.getByText('笔记'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(globalHandler).not.toHaveBeenCalled()
    document.removeEventListener('keydown', globalHandler)
  })

  it('prevents pointer focus from collapsing the document selection', () => {
    const text = document.createElement('p')
    text.textContent = '保留这段选区'
    document.body.append(text)
    const range = document.createRange()
    range.selectNodeContents(text)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    render(<SelectionMenu onClose={() => {}} onPick={() => {}} x={100} y={100} />)

    expect(fireEvent.mouseDown(screen.getByRole('menuitem', { name: '笔记' }))).toBe(false)
    expect(window.getSelection()?.toString()).toBe('保留这段选区')
    text.remove()
  })

  it('disables expand with an explanation while generation is busy', () => {
    const status = document.createElement('div')
    status.dataset.testid = 'assistant-status'
    document.body.append(status)
    render(<SelectionMenu onClose={() => {}} onPick={() => {}} x={10} y={10} />)
    expect(screen.getByRole('menuitem', { name: '就此展开' })).toBeDisabled()
    expect(screen.getByText('生成进行中，暂不能展开')).toBeInTheDocument()
    status.remove()
  })
})
