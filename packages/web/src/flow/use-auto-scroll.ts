import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const THRESHOLD = 4

/**
 * Keeps a scroll container pinned to the bottom as `dep` changes (e.g. a
 * streaming answer grows). If the user scrolls up, auto-pinning pauses and
 * `showButton` becomes true so a "jump to bottom" affordance can be shown.
 */
export function useAutoScroll(
  ref: { current: HTMLElement | null },
  dep: unknown,
): { scrollToBottom(): void; showButton: boolean } {
  const pinnedRef = useRef(true)
  const [showButton, setShowButton] = useState(false)

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedRef.current = true
    setShowButton(false)
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= THRESHOLD
      pinnedRef.current = atBottom
      setShowButton(!atBottom)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [ref, dep])

  return { scrollToBottom, showButton }
}
