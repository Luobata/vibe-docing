export function transitionDocument(update: () => void): void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const start = document.startViewTransition
  if (reduced || !start) {
    update()
    return
  }
  start.call(document, update)
}

export function scrollMainDocumentToTop(): void {
  const scroll = document.querySelector<HTMLElement>('[data-testid="conversation-scroll"]')
  if (!scroll) return
  scroll.scrollTop = 0
  scroll.scrollTo?.({ behavior: 'auto', left: 0, top: 0 })
}
