export function AssistantStatus({
  onStop,
  phase,
}: {
  onStop(): void
  phase: 'cancelling' | 'replying' | 'thinking'
}) {
  return (
    <div className="assistant-status" data-testid="assistant-status" role="status">
      <span>
        {phase === 'thinking'
          ? 'AI 正在思考…'
          : phase === 'replying'
            ? 'AI 正在回复…'
            : '正在停止生成…'}
      </span>
      <button disabled={phase === 'cancelling'} onClick={onStop} type="button">
        {phase === 'cancelling' ? '停止中' : '停止'}
      </button>
    </div>
  )
}
