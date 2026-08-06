export function AssistantStatus({
  onStop,
  phase,
}: {
  onStop(): void
  phase: 'replying' | 'thinking'
}) {
  return (
    <div className="assistant-status" data-testid="assistant-status" role="status">
      <span>{phase === 'thinking' ? 'AI 正在思考…' : 'AI 正在回复…'}</span>
      <button onClick={onStop} type="button">停止</button>
    </div>
  )
}
