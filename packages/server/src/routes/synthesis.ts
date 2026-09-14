import { lineDiff } from '@vibe/shared'
import type { DecoratedApp } from '../app'
import type { AppReply, AppRequest } from '../http/app-instance'
import { ProviderConfigError, resolveProvider } from '../provider/registry'
import { SynthesisRunningError } from '../repo/synthesis-repo'
import { SynthesisError } from '../service/synthesis-service'

function record(body: unknown): Record<string, unknown> | undefined {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined
}
function requestAbort(request: AppRequest, reply: AppReply) {
  const controller = new AbortController()
  const closeRequest = () => { if (request.raw?.aborted || request.raw?.socket?.destroyed) controller.abort() }
  const closeReply = () => { if (!reply.raw.writableEnded) controller.abort() }
  request.raw?.on?.('close', closeRequest)
  reply.raw.on?.('close', closeReply)
  return { controller, cleanup() {
    request.raw?.off?.('close', closeRequest)
    reply.raw.off?.('close', closeReply)
  } }
}
function sendError(reply: AppReply, error: unknown): unknown {
  if (error instanceof ProviderConfigError) return reply.code(503).send({ code: 'PROVIDER_CONFIG', error: error.message })
  if (error instanceof SynthesisRunningError) return reply.code(409).send({ code: 'SYNTHESIS_RUNNING', error: error.message, synthesisId: error.synthesisId })
  if (error instanceof SynthesisError) return reply.code(error.statusCode).send({ error: error.message })
  return reply.code(502).send({ error: error instanceof Error ? error.message : 'generation failed' })
}

export function registerSynthesisRoutes(app: DecoratedApp): void {
  const { deps } = app
  const activeSynthesis = (id: string) => {
    const synthesis = deps.syntheses.get(id)
    return synthesis && deps.trees.get(synthesis.treeId) ? synthesis : undefined
  }
  app.post('/api/trees/:id/synthesize', async (request, reply) => {
    let prepared
    let provider
    try {
      if (!deps.trees.get(request.params.id)) return reply.code(404).send({ error: 'tree not found' })
      provider = resolveProvider(deps, deps.providerOverride)
      prepared = deps.synthesis.prepare(request.params.id)
    } catch (error) { return sendError(reply, error) }
    const abort = requestAbort(request, reply)
    const { id } = prepared.synthesis
    reply.hijack()
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const send = (event: unknown) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) { abort.controller.abort(); return }
      try { reply.raw.write(`data: ${JSON.stringify(event)}\n\n`) }
      catch (error) { abort.controller.abort(error) }
    }
    try {
      reply.raw.writeHead(200, { 'cache-control': 'no-cache', connection: 'keep-alive', 'content-type': 'text/event-stream; charset=utf-8' })
      send({ type: 'started', synthesis: prepared.synthesis, total: prepared.input.nodes.length })
      let ticks = 0
      heartbeat = setInterval(() => {
        // Cancellation lives in the DB; only this request owns the provider signals.
        if (deps.syntheses.get(id)?.status === 'cancelled') abort.controller.abort(new Error('成文已取消'))
        if (++ticks % 10 === 0) send({ type: 'ping' })
      }, 1_000)
      const synthesis = await deps.synthesis.run(prepared, provider, abort.controller.signal, send)
      const failed = Object.values(synthesis.nodeResults).filter((result) => result.status === 'failed').length
      send({ type: synthesis.status === 'failed' ? 'error' : synthesis.status === 'cancelled' ? 'cancelled' : 'done',
        synthesis, failed, ...(synthesis.error ? { message: synthesis.error } : {}) })
    } catch (error) {
      const synthesis = deps.syntheses.finish(id, { status: abort.controller.signal.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : String(error) })
      send({ type: 'error', synthesis, message: synthesis?.error })
    } finally {
      clearInterval(heartbeat)
      abort.cleanup()
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
    }
  })
  app.get('/api/trees/:id/syntheses', async (request, reply) => {
    if (!deps.trees.get(request.params.id)) return reply.code(404).send({ error: 'tree not found' })
    return { syntheses: deps.syntheses.listByTree(request.params.id) }
  })
  app.get('/api/syntheses/:id', async (request, reply) => {
    const synthesis = activeSynthesis(request.params.id)
    return synthesis ? { synthesis } : reply.code(404).send({ error: 'synthesis not found' })
  })
  app.post('/api/syntheses/:id/cancel', async (request, reply) => {
    if (!activeSynthesis(request.params.id)) return reply.code(404).send({ error: 'synthesis not found' })
    return { synthesis: deps.syntheses.finish(request.params.id, { status: 'cancelled', error: '成文已取消' }) }
  })
  app.get('/api/syntheses/:id/diff/:previousId', async (request, reply) => {
    const current = activeSynthesis(request.params.id)
    const previous = activeSynthesis(request.params.previousId)
    if (!current || !previous || current.treeId !== previous.treeId) return reply.code(404).send({ error: 'synthesis not found' })
    return { lines: lineDiff(previous.contentMd ?? '', current.contentMd ?? '') }
  })
  app.patch('/api/nodes/:id/verdict', async (request, reply) => {
    const verdict = record(request.body)?.verdict
    if (verdict !== null && verdict !== 'adopted' && verdict !== 'rejected' && verdict !== 'superseded') return reply.code(400).send({ error: 'invalid verdict' })
    const node = deps.nodes.get(request.params.id)
    if (!node || node.is_deleted || !deps.trees.get(node.tree_id)) return reply.code(404).send({ error: 'node not found' })
    deps.syntheses.setVerdict(node.id, verdict)
    return { node: deps.nodes.get(node.id) }
  })
  app.get('/api/trees/:id/decisions', async (request, reply) => {
    if (!deps.trees.get(request.params.id)) return reply.code(404).send({ error: 'tree not found' })
    return { merges: deps.merges.listByTree(request.params.id),
      nodes: deps.db.prepare('SELECT id, parent_id, user_input, verdict, updated_at FROM nodes WHERE tree_id = ? AND is_deleted = 0 AND verdict IS NOT NULL ORDER BY updated_at, id').all(request.params.id) }
  })
  app.get('/api/trees/:id/open-questions', async (request, reply) => {
    if (!deps.trees.get(request.params.id)) return reply.code(404).send({ error: 'tree not found' })
    return { questions: deps.openQuestions.listByTree(request.params.id) }
  })
  app.post('/api/trees/:id/open-questions/extract', async (request, reply) => {
    const abort = requestAbort(request, reply)
    try { return { questions: await deps.synthesis.extractQuestions(request.params.id, resolveProvider(deps, deps.providerOverride), abort.controller.signal) } }
    catch (error) { return sendError(reply, error) }
    finally { abort.cleanup() }
  })
  app.patch('/api/open-questions/:id', async (request, reply) => {
    const body = record(request.body)
    if (!body || (body.status === undefined && body.question === undefined)
      || (body.status !== undefined && body.status !== 'open' && body.status !== 'resolved')
      || (body.question !== undefined && (typeof body.question !== 'string' || !body.question.trim()))) return reply.code(400).send({ error: 'invalid question update' })
    const question = deps.openQuestions.get(request.params.id)
    if (!question || !deps.trees.get(question.tree_id)) return reply.code(404).send({ error: 'question not found' })
    try { return { question: deps.openQuestions.update(question.id, { question: body.question as string | undefined, status: body.status as 'open' | 'resolved' | undefined }) } }
    catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return reply.code(409).send({ error: 'question already exists' })
      throw error
    }
  })
  app.get('/api/trees/:id/retrospective', async (request, reply) => {
    if (!deps.trees.get(request.params.id)) return reply.code(404).send({ error: 'tree not found' })
    return { retrospective: deps.syntheses.retrospective(request.params.id) ?? null }
  })
  app.post('/api/trees/:id/retrospective', async (request, reply) => {
    const abort = requestAbort(request, reply)
    try { return await deps.synthesis.retrospective(request.params.id, resolveProvider(deps, deps.providerOverride), abort.controller.signal) }
    catch (error) { return sendError(reply, error) }
    finally { abort.cleanup() }
  })
}
