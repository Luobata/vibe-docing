import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'workbench.cols'
const DEFAULT_LEFT = 280
const DEFAULT_RIGHT = 360
const MIN_LEFT = 180
const MIN_RIGHT = 260
const CENTER_MIN = 360
const RESIZER_WIDTHS = 12

export type ColumnSide = 'left' | 'right'
export const COLUMN_MIN_WIDTHS = { left: MIN_LEFT, right: MIN_RIGHT } as const

interface Cols {
  left: number
  right: number
}

function readStored(): Cols {
  const fallback: Cols = { left: DEFAULT_LEFT, right: DEFAULT_RIGHT }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Cols>
    return {
      left: typeof parsed.left === 'number' ? parsed.left : DEFAULT_LEFT,
      right: typeof parsed.right === 'number' ? parsed.right : DEFAULT_RIGHT,
    }
  } catch {
    return fallback
  }
}

function persist(cols: Cols): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols))
  } catch {
    // ignore quota / unavailable storage
  }
}

export function getColumnMaxWidth(side: ColumnSide): number {
  const otherMin = side === 'left' ? MIN_RIGHT : MIN_LEFT
  return Math.max(COLUMN_MIN_WIDTHS[side], window.innerWidth - RESIZER_WIDTHS - CENTER_MIN - otherMin)
}

function clamp(value: number, side: ColumnSide): number {
  return Math.min(Math.max(value, COLUMN_MIN_WIDTHS[side]), getColumnMaxWidth(side))
}

function fitColumns(cols: Cols, priority: ColumnSide): Cols {
  const available = Math.max(MIN_LEFT + MIN_RIGHT, window.innerWidth - RESIZER_WIDTHS - CENTER_MIN)
  const other: ColumnSide = priority === 'left' ? 'right' : 'left'
  const next: Cols = {
    left: clamp(cols.left, 'left'),
    right: clamp(cols.right, 'right'),
  }
  if (next.left + next.right <= available) return next
  next[other] = Math.max(COLUMN_MIN_WIDTHS[other], available - next[priority])
  if (next.left + next.right > available) {
    next[priority] = Math.max(COLUMN_MIN_WIDTHS[priority], available - next[other])
  }
  return next
}

/**
 * Manages the draggable widths of the workbench's outer columns. Widths are
 * seeded from localStorage (key `workbench.cols`) and written back on drag end
 * or reset. `startDrag` wires transient window `mousemove`/`mouseup` listeners
 * so the drag keeps tracking even when the cursor leaves the thin handle.
 */
export function useColumnResize(): {
  leftWidth: number
  rightWidth: number
  resizeSide(side: ColumnSide, width: number): void
  startDrag(side: ColumnSide, clientX: number): void
  resetSide(side: ColumnSide): void
} {
  const initialRef = useRef<Cols | null>(null)
  if (!initialRef.current) {
    const stored = readStored()
    initialRef.current = window.innerWidth >= 1024 ? fitColumns(stored, 'left') : stored
  }
  const initial = initialRef.current
  const [leftWidth, setLeftWidth] = useState(initial.left)
  const [rightWidth, setRightWidth] = useState(initial.right)

  // Latest widths, so drag-end persistence and reset always see fresh values
  // without re-binding listeners on every render.
  const widthsRef = useRef<Cols>({ left: initial.left, right: initial.right })
  widthsRef.current = { left: leftWidth, right: rightWidth }

  useEffect(() => {
    const handleViewportResize = (): void => {
      // Tablet/mobile layouts ignore the persisted outer-column variables.
      // Preserve desktop widths until the three-column layout returns.
      if (window.innerWidth < 1024) return
      const next = fitColumns(widthsRef.current, 'left')
      if (next.left === widthsRef.current.left && next.right === widthsRef.current.right) return
      widthsRef.current = next
      setLeftWidth(next.left)
      setRightWidth(next.right)
      persist(next)
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  const resizeSide = useCallback((side: ColumnSide, width: number) => {
    const next = fitColumns({ ...widthsRef.current, [side]: width }, side)
    widthsRef.current = next
    setLeftWidth(next.left)
    setRightWidth(next.right)
    persist(next)
  }, [])

  const startDrag = useCallback((side: ColumnSide, clientX: number) => {
    const startClientX = clientX
    const startWidth = side === 'left' ? widthsRef.current.left : widthsRef.current.right

    const onMove = (event: MouseEvent): void => {
      const delta = event.clientX - startClientX
      const width = side === 'left' ? startWidth + delta : startWidth - delta
      const next = fitColumns({ ...widthsRef.current, [side]: width }, side)
      widthsRef.current = next
      setLeftWidth(next.left)
      setRightWidth(next.right)
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      persist(widthsRef.current)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const resetSide = useCallback((side: ColumnSide) => {
    const width = side === 'left' ? DEFAULT_LEFT : DEFAULT_RIGHT
    const next = fitColumns({ ...widthsRef.current, [side]: width }, side)
    widthsRef.current = next
    setLeftWidth(next.left)
    setRightWidth(next.right)
    persist(next)
  }, [])

  return { leftWidth, resizeSide, rightWidth, startDrag, resetSide }
}
