export function SelectionMenu({ onClose, onPick, x, y }: {
  onClose(): void
  onPick(kind: 'note' | 'expand'): void
  x: number
  y: number
}) {
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
