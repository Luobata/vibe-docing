import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generationTaskRegistry } from '../state/workbench-store'
import { SelectionMenu } from './SelectionMenu'

describe('SelectionMenu', () => {
  beforeEach(() => generationTaskRegistry.reset())
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

  it('keeps expand available while another generation is active', () => {
    const status = document.createElement('div')
    status.dataset.testid = 'assistant-status'
    document.body.append(status)
    render(<SelectionMenu onClose={() => {}} onPick={() => {}} x={10} y={10} />)
    expect(screen.getByRole('menuitem', { name: '就此展开' })).toBeEnabled()
    expect(screen.queryByText('生成进行中，暂不能展开')).not.toBeInTheDocument()
    status.remove()
  })

  it('disables only the matching selection key and keeps a different anchor available', () => {
    const matchingKey = 'fork-expand:root:0:5'
    const otherAnchorKey = 'fork-expand:root:6:12'
    generationTaskRegistry.start({
      key: matchingKey,
      kind: 'fork-expand',
      ownerMainNodeId: 'root',
    })
    const { rerender } = render(
      <SelectionMenu
        onClose={() => {}}
        onPick={() => {}}
        taskKey={matchingKey}
        x={10}
        y={10}
      />,
    )

    const expand = screen.getByRole('menuitem', { name: '就此展开' })
    expect(expand).toBeDisabled()
    expect(expand).toHaveAttribute('aria-describedby', 'selection-expand-busy-reason')
    expect(screen.getByText('该选区的展开正在进行中')).toHaveAttribute('data-task-key', matchingKey)

    rerender(
      <SelectionMenu
        onClose={() => {}}
        onPick={() => {}}
        taskKey={otherAnchorKey}
        x={10}
        y={10}
      />,
    )

    expect(screen.getByRole('menuitem', { name: '就此展开' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: '就此展开' })).toHaveAttribute('data-task-key', otherAnchorKey)
    expect(screen.queryByText('该选区的展开正在进行中')).not.toBeInTheDocument()
  })
})
