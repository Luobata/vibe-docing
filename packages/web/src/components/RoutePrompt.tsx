import type { RouteCandidate } from '../api/types'
import type { RouteUi } from '../flow/answer-flow'

export function RoutePrompt({
  decision,
  onAccept,
  onDismiss,
  onPick,
}: {
  decision: RouteUi
  onAccept(candidate: RouteCandidate): void
  onDismiss(): void
  onPick(candidate: RouteCandidate): void
}) {
  if (decision.action === 'none') return null
  if (decision.action === 'suggest') {
    return (
      <div className="route-prompt" role="status">
        <span>这轮更像在深入「{decision.candidate.label}」，搬过去？</span>
        <button onClick={() => onAccept(decision.candidate)} type="button">搬过去</button>
        <button onClick={onDismiss} type="button">留下</button>
      </div>
    )
  }
  return (
    <div aria-label="选择回答落点" className="route-prompt" role="dialog">
      <strong>这轮放到哪里？</strong>
      <div className="route-candidates">
        {decision.candidates.map((candidate, index) => (
          <button
            key={`${candidate.target}:${candidate.refId ?? 'main'}:${index}`}
            onClick={() => onPick(candidate)}
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <button onClick={onDismiss} type="button">都不对，接主文档下</button>
    </div>
  )
}
