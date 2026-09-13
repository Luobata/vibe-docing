import type { DecoratedApp } from '../app'
import type { AppReply, AppRequest } from '../http/app-instance'
import { ProviderConfigError, resolveProvider } from '../provider/registry'
import { DISCUSSION_MOVES, DiscussionError, type DiscussionMove } from '../service/discussion-service'

function record(body: unknown): Record<string, unknown> | undefined {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined
}

function requestAbort(request: AppRequest, reply: AppReply) {
  const controller = new AbortController()
  const closeRequest = () => {
    if (request.raw?.aborted || request.raw?.socket?.destroyed) controller.abort()
  }
  const closeReply = () => { if (!reply.raw.writableEnded) controller.abort() }
  request.raw?.on?.('close', closeRequest)
  reply.raw.on?.('close', closeReply)
  return {
    signal: controller.signal,
    cleanup() {
      request.raw?.off?.('close', closeRequest)
      reply.raw.off?.('close', closeReply)
    },
  }
}

function sendError(reply: AppReply, error: unknown): unknown {
  if (error instanceof ProviderConfigError) return reply.code(503).send({ code: 'PROVIDER_CONFIG', error: error.message })
  if (error instanceof DiscussionError) return reply.code(error.statusCode).send({ error: error.message, ...error.details })
  throw error
}

export function registerDiscussionRoutes(app: DecoratedApp): void {
  app.get('/api/nodes/:id/discussion', async (request, reply) => {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) return reply.code(404).send({ error: 'node not found' })
    return { messages: app.deps.discussionMessages.listByNode(node.id) }
  })

  async function stream(request: AppRequest, reply: AppReply, input: { userInput?: string; move?: DiscussionMove }) {
    const node = app.deps.nodes.get(request.params.id)
    if (!node || node.is_deleted === 1) return reply.code(404).send({ error: 'node not found' })
    let provider
    try { provider = resolveProvider(app.deps, app.deps.providerOverride) } catch (error) { return sendError(reply, error) }
    reply.hijack()
    reply.raw.writeHead(200, {
      'cache-control': 'no-cache', connection: 'keep-alive', 'content-type': 'text/event-stream; charset=utf-8',
    })
    const abort = requestAbort(request, reply)
    let refreshWatchdog: (() => void) | undefined
    const send = (event: unknown) => {
      if (abort.signal.aborted || reply.raw.destroyed || reply.raw.writableEnded) return
      try {
        // A false return still accepts the write into Node's buffer (backpressure).
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        // Failed writes do not feed the watchdog; it will cancel a stalled route.
        return
      }
      refreshWatchdog?.()
    }
    const heartbeat = setInterval(() => send({ type: 'ping' }), 10_000)
    try {
      const result = await app.deps.discussion.discuss({ ...input, nodeId: node.id, provider, signal: abort.signal,
        subscribeToActivity(refresh) {
          refreshWatchdog = refresh
          return () => { refreshWatchdog = undefined }
        },
      }, send)
      send({ type: 'done', ...result })
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : 'discussion failed',
        ...(error instanceof DiscussionError ? error.details : {}),
        messages: app.deps.discussionMessages.listByNode(node.id) })
    } finally {
      clearInterval(heartbeat)
      abort.cleanup()
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
    }
  }

  app.post('/api/nodes/:id/discussion', async (request, reply) => {
    const userInput = record(request.body)?.userInput
    if (typeof userInput !== 'string' || !userInput.trim()) return reply.code(400).send({ error: 'invalid userInput' })
    return stream(request, reply, { userInput })
  })

  app.post('/api/nodes/:id/discussion/moves', async (request, reply) => {
    const move = record(request.body)?.move
    if (typeof move !== 'string' || !Object.hasOwn(DISCUSSION_MOVES, move)) return reply.code(400).send({ error: 'invalid move' })
    return stream(request, reply, { move: move as DiscussionMove })
  })

  app.post('/api/nodes/:id/discussion/promote', async (request, reply) => {
    const body = record(request.body)
    const mode = body?.mode
    const messageIds = body?.messageIds
    if ((mode !== 'section' && mode !== 'child') || !Array.isArray(messageIds) || !messageIds.length
      || !messageIds.every((id) => typeof id === 'string' && id.trim())
      || (mode === 'section' && (!Number.isInteger(body?.baseRevision) || (body!.baseRevision as number) < 0))) {
      return reply.code(400).send({ error: 'invalid promotion body' })
    }
    const abort = requestAbort(request, reply)
    try {
      const provider = resolveProvider(app.deps, app.deps.providerOverride)
      return await app.deps.discussion.promote({ nodeId: request.params.id, mode, messageIds,
        baseRevision: body?.baseRevision as number | undefined, provider, signal: abort.signal })
    } catch (error) {
      return sendError(reply, error)
    } finally {
      abort.cleanup()
    }
  })
}
