import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { generationTaskRegistry, useGenerationTasks } from '../state/workbench-store'

export function SelectionMenu({ onClose, onPick, taskKey = 'fork-expand:unknown:whole:whole', x, y }: {
  onClose(): void
  onPick(kind: 'note' | 'expand'): void
  taskKey?: string
  x: number
  y: number
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [placement, setPlacement] = useState<'bottom' | 'top'>('top')
  const task = useGenerationTasks((snapshot) => snapshot.byKey[taskKey])
  const busy = Boolean(task && generationTaskRegistry.isTaskLive(task))

  useLayoutEffect(() => {
    const update = () => {
      const rect = menuRef.current?.getBoundingClientRect()
      const width = rect?.width || 152
      const height = rect?.height || 84
      const gap = 10
      const edge = 8
      const flipBelow = y < window.innerHeight / 4 || y - height - gap < edge
      const nextTop = flipBelow ? y + gap : y - height - gap
      setPlacement(flipBelow ? 'bottom' : 'top')
      setPosition({
        left: Math.min(Math.max(edge, x - width / 2), Math.max(edge, window.innerWidth - width - edge)),
        top: Math.min(Math.max(edge, nextTop), Math.max(edge, window.innerHeight - height - edge)),
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [x, y])

  useEffect(() => {
    let distance = 0
    const positions = new Map<EventTarget, { left: number; top: number }>()
    const tracked = document.querySelectorAll<HTMLElement>('.main-doc-scroll, .tree-panel, .subdoc-panel')
    tracked.forEach((element) => positions.set(element, { left: element.scrollLeft, top: element.scrollTop }))
    positions.set(window, { left: window.scrollX, top: window.scrollY })
    const onScroll = (event: Event) => {
      const target: EventTarget = event.target === document ? window : (event.target ?? window)
      const current = target instanceof Element
        ? { left: target.scrollLeft, top: target.scrollTop }
        : { left: window.scrollX, top: window.scrollY }
      const previous = positions.get(target)
      positions.set(target, current)
      if (!previous) return
      distance += Math.abs(current.left - previous.left) + Math.abs(current.top - previous.top)
      if (distance >= 40) onClose()
    }
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('scroll', onScroll)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('scroll', onScroll)
    }
  }, [onClose])

  useEffect(() => {
    // Esc closes the menu. Capture + stopPropagation keeps it from bubbling to
    // the global keydown listener (which would otherwise exit focus mode).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  function preserveSelection(event: ReactMouseEvent): void {
    event.preventDefault()
  }

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div
        className="selection-menu"
        data-placement={placement}
        onMouseDown={preserveSelection}
        ref={menuRef}
        role="menu"
        style={{ left: position.left, position: 'fixed', top: position.top }}
      >
        <button onClick={() => onPick('note')} role="menuitem" type="button">笔记</button>
        <button
          aria-describedby={busy ? 'selection-expand-busy-reason' : undefined}
          data-gen-status={busy ? 'streaming' : undefined}
          data-task-key={taskKey}
          disabled={busy}
          onClick={() => onPick('expand')}
          role="menuitem"
          type="button"
        >
          就此展开
        </button>
        {busy && (
          <span
            className="selection-menu-reason"
            data-gen-status="streaming"
            data-task-key={taskKey}
            id="selection-expand-busy-reason"
            role="status"
          >
            该选区的展开正在进行中
          </span>
        )}
      </div>
    </>
  )
}
