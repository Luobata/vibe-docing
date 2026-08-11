import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

const DEFAULT_COLLAPSED_LINES = 2
const DEFAULT_OVERFLOW_HINT_LENGTH = 96

export interface MainQuestionSummaryProps {
  /** The complete, unmodified main question. */
  text: string
  /** Optional id for the text region controlled by the disclosure button. */
  contentId?: string
  /** Appended to the root class for placement-specific styling. */
  className?: string
  /** Number of lines visible in the compact state. */
  collapsedLines?: number
}

/**
 * A compact, accessible disclosure for a long main question.
 *
 * The complete text always remains in the document; the collapsed state only
 * changes its visual presentation. Native button semantics provide keyboard
 * activation without introducing document or routing behaviour.
 */
export function MainQuestionSummary({
  text,
  contentId,
  className,
  collapsedLines = DEFAULT_COLLAPSED_LINES,
}: MainQuestionSummaryProps) {
  const generatedId = useId()
  const textId = contentId ?? `main-question-summary-${generatedId.replace(/:/g, '')}`
  const textRef = useRef<HTMLHeadingElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(() => likelyOverflows(text, collapsedLines))

  useEffect(() => {
    setExpanded(false)
    setCanExpand(likelyOverflows(text, collapsedLines))
  }, [collapsedLines, text])

  useLayoutEffect(() => {
    if (expanded) return
    const element = textRef.current
    if (!element) return

    const measure = () => {
      const measuredOverflow = element.scrollHeight > element.clientHeight + 1
      setCanExpand(measuredOverflow || likelyOverflows(text, collapsedLines))
    }

    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [collapsedLines, expanded, text])

  const rootClassName = ['main-question-summary', className].filter(Boolean).join(' ')
  const textClassName = expanded
    ? 'main-question-summary__text is-expanded'
    : 'main-question-summary__text is-collapsed'
  const compactStyle = expanded ? undefined : {
    maxHeight: `${collapsedLines * 1.45}em`,
    overflow: 'hidden',
  } satisfies CSSProperties

  return (
    <div className={rootClassName} data-state={expanded ? 'expanded' : 'collapsed'}>
      <div className="main-question-summary__content">
        <h2
          className={textClassName}
          id={textId}
          ref={textRef}
          style={compactStyle}
        >
          {text}
        </h2>
        {canExpand && (
          <button
            aria-controls={textId}
            aria-expanded={expanded}
            className="main-question-summary__toggle"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
      </div>
    </div>
  )
}

function likelyOverflows(text: string, collapsedLines: number): boolean {
  const lineCount = text.split(/\r?\n/).length
  return lineCount > collapsedLines || text.length > DEFAULT_OVERFLOW_HINT_LENGTH
}
