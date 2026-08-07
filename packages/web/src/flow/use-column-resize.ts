import { useCallback, useRef, useState } from 'react'

const STORAGE_KEY = 'workbench.cols'
const DEFAULT_LEFT = 280
const DEFAULT_RIGHT = 360
const MIN_LEFT = 180
const MIN_RIGHT = 260

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

function maxWidth(): number {
  return window.innerWidth * 0.5
}

function clamp(value: number, min: number): number {
  return Math.min(Math.max(value, min), maxWidth())
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
  startDrag(side: 'left' | 'right', clientX: number): void
  resetSide(side: 'left' | 'right'): void
} {
  const initial = readStored()
  const [leftWidth, setLeftWidth] = useState(initial.left)
  const [rightWidth, setRightWidth] = useState(initial.right)

  // Latest widths, so drag-end persistence and reset always see fresh values
  // without re-binding listeners on every render.
  const widthsRef = useRef<Cols>({ left: initial.left, right: initial.right })
  widthsRef.current = { left: leftWidth, right: rightWidth }

  const startDrag = useCallback((side: 'left' | 'right', clientX: number) => {
    const startClientX = clientX
    const startWidth = side === 'left' ? widthsRef.current.left : widthsRef.current.right

    const onMove = (event: MouseEvent): void => {
      const delta = event.clientX - startClientX
      if (side === 'left') {
        const next = clamp(startWidth + delta, MIN_LEFT)
        setLeftWidth(next)
      } else {
        const next = clamp(startWidth - delta, MIN_RIGHT)
        setRightWidth(next)
      }
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      persist(widthsRef.current)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const resetSide = useCallback((side: 'left' | 'right') => {
    if (side === 'left') {
      setLeftWidth(DEFAULT_LEFT)
      const next = { left: DEFAULT_LEFT, right: widthsRef.current.right }
      widthsRef.current = next
      persist(next)
    } else {
      setRightWidth(DEFAULT_RIGHT)
      const next = { left: widthsRef.current.left, right: DEFAULT_RIGHT }
      widthsRef.current = next
      persist(next)
    }
  }, [])

  return { leftWidth, rightWidth, startDrag, resetSide }
}
