export function AssistantStatus({
  onStop,
  phase,
  taskKey = 'ask:unknown',
}: {
  onStop(key: string): void
  phase: 'replying' | 'stopping' | 'thinking'
  taskKey?: string
}) {
  return (
    <div
      className="assistant-status"
      data-gen-status="streaming"
      data-task-key={taskKey}
      data-testid="assistant-status"
      role="status"
    >
      <span>
        {phase === 'thinking'
          ? 'AI 正在思考…'
          : phase === 'replying'
            ? 'AI 正在回复…'
            : '正在停止生成…'}
      </span>
      <button
        data-gen-status="streaming"
        data-task-key={taskKey}
        disabled={phase === 'stopping'}
        onClick={() => onStop(taskKey)}
        type="button"
      >
        {phase === 'stopping' ? '停止中' : '停止'}
      </button>
    </div>
  )
}
