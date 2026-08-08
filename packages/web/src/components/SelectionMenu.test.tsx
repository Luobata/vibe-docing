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
})
