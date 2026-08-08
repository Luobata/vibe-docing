import { useEffect } from 'react'

export function SelectionMenu({ onClose, onPick, x, y }: {
  onClose(): void
  onPick(kind: 'note' | 'expand'): void
  x: number
  y: number
}) {
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

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="selection-menu" role="menu" style={{ left: x, position: 'fixed', top: y }}>
        <button onClick={() => onPick('note')} role="menuitem" type="button">笔记</button>
        <button onClick={() => onPick('expand')} role="menuitem" type="button">就此展开</button>
      </div>
    </>
  )
}
