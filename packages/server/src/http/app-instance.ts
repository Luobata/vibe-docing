import { createRequire } from 'node:module'
import { createServer, type Server, type ServerResponse } from 'node:http'

export interface AppRequest {
  body: unknown
  method: string
  params: Record<string, string>
  url: string
}

export interface AppReply {
  code(statusCode: number): AppReply
  header(name: string, value: string): AppReply
  hijack(): AppReply
  raw: {
    end(chunk?: string): void
    write(chunk: string): boolean
    writeHead(statusCode: number, headers?: Record<string, string>): void
  }
  send(payload: unknown): AppReply
}

export type RouteHandler = (
  request: AppRequest,
  reply: AppReply,
) => unknown | Promise<unknown>

export interface InjectOptions {
  method: string
  payload?: unknown
  url: string
}

export interface InjectResponse {
  body: string
  headers: Record<string, string>
  json<T = any>(): T
  statusCode: number
}

export interface AppInstance {
  [key: string]: unknown
  close(): Promise<void>
  decorate(name: string, value: unknown): void
  delete(path: string, handler: RouteHandler): void
  get(path: string, handler: RouteHandler): void
  inject(options: InjectOptions): Promise<InjectResponse>
  listen(options: { host?: string; port: number }): Promise<unknown>
  patch(path: string, handler: RouteHandler): void
  post(path: string, handler: RouteHandler): void
  put(path: string, handler: RouteHandler): void
  register(plugin: unknown, options?: unknown): unknown
}

interface RegisteredRoute {
  handler: RouteHandler
  keys: string[]
  method: string
  pattern: RegExp
}

interface DispatchState {
  body: string
  ended: boolean
  headers: Record<string, string>
  sent: boolean
  statusCode: number
}

const require = createRequire(import.meta.url)

function nativeFastify(): AppInstance | undefined {
  try {
    const loaded = require('fastify') as
      | ((options: { logger: boolean }) => AppInstance)
      | { default: (options: { logger: boolean }) => AppInstance }
    const factory = typeof loaded === 'function' ? loaded : loaded.default
    return factory({ logger: false })
  } catch {
    return undefined
  }
}

function compilePath(path: string): { keys: string[]; pattern: RegExp } {
  const keys: string[] = []
  const source = path
    .split('/')
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      keys.push(part.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { keys, pattern: new RegExp(`^${source}$`) }
}

function serialize(payload: unknown, headers: Record<string, string>): string {
  if (typeof payload === 'string') return payload
  if (payload === undefined) return ''
  headers['content-type'] ??= 'application/json; charset=utf-8'
  return JSON.stringify(payload)
}

function createFallbackApp(): AppInstance {
  const routes: RegisteredRoute[] = []
  let server: Server | undefined

  function addRoute(method: string, path: string, handler: RouteHandler): void {
    const { keys, pattern } = compilePath(path)
    routes.push({ handler, keys, method, pattern })
  }

  async function dispatch(
    method: string,
    rawUrl: string,
    payload: unknown,
    target?: ServerResponse,
  ): Promise<DispatchState> {
    const url = new URL(rawUrl, 'http://127.0.0.1').pathname
    const route = routes.find((candidate) => {
      return candidate.method === method.toUpperCase() && candidate.pattern.test(url)
    })
    const state: DispatchState = {
      body: '',
      ended: false,
      headers: target ? { 'access-control-allow-origin': '*' } : {},
      sent: false,
      statusCode: 200,
    }
    if (!route) {
      state.statusCode = 404
      state.body = serialize({ error: 'not found' }, state.headers)
      if (target) {
        target.writeHead(state.statusCode, state.headers)
        target.end(state.body)
      }
      return state
    }

    const match = route.pattern.exec(url)!
    const params = Object.fromEntries(
      route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]),
    )
    const reply: AppReply = {
      code(statusCode) {
        state.statusCode = statusCode
        return reply
      },
      header(name, value) {
        state.headers[name.toLowerCase()] = value
        return reply
      },
      hijack() {
        return reply
      },
      raw: {
        end(chunk = '') {
          if (chunk) {
            state.body += chunk
            target?.write(chunk)
          }
          state.ended = true
          target?.end()
        },
        write(chunk) {
          state.body += chunk
          return target ? target.write(chunk) : true
        },
        writeHead(statusCode, headers = {}) {
          state.statusCode = statusCode
          for (const [name, value] of Object.entries(headers)) {
            state.headers[name.toLowerCase()] = value
          }
          target?.writeHead(statusCode, state.headers)
        },
      },
      send(body) {
        state.body = serialize(body, state.headers)
        state.sent = true
        return reply
      },
    }

    try {
      const result = await route.handler(
        { body: payload, method: method.toUpperCase(), params, url },
        reply,
      )
      if (!state.sent && !state.ended && result !== undefined && result !== reply) {
        state.body = serialize(result, state.headers)
      }
    } catch (error) {
      state.statusCode = 500
      state.body = serialize(
        { error: error instanceof Error ? error.message : 'internal error' },
        state.headers,
      )
    }

    if (target && !state.ended) {
      target.writeHead(state.statusCode, state.headers)
      target.end(state.body)
      state.ended = true
    }
    return state
  }

  const app: AppInstance = {
    async close() {
      if (!server) return
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()))
      })
      server = undefined
    },
    decorate(name, value) {
      app[name] = value
    },
    delete(path, handler) {
      addRoute('DELETE', path, handler)
    },
    get(path, handler) {
      addRoute('GET', path, handler)
    },
    async inject(options) {
      const state = await dispatch(options.method, options.url, options.payload)
      return {
        body: state.body,
        headers: state.headers,
        json<T = any>() {
          return JSON.parse(state.body) as T
        },
        statusCode: state.statusCode,
      }
    },
    async listen(options) {
      server = createServer(async (request, response) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const rawBody = Buffer.concat(chunks).toString('utf8')
        let body: unknown = undefined
        if (rawBody) {
          try {
            body = JSON.parse(rawBody)
          } catch {
            body = rawBody
          }
        }
        await dispatch(request.method ?? 'GET', request.url ?? '/', body, response)
      })
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(options.port, options.host ?? '127.0.0.1', resolve)
      })
      return server.address()
    },
    patch(path, handler) {
      addRoute('PATCH', path, handler)
    },
    post(path, handler) {
      addRoute('POST', path, handler)
    },
    put(path, handler) {
      addRoute('PUT', path, handler)
    },
    register() {
      return app
    },
  }
  return app
}

export function createAppInstance(): AppInstance {
  return nativeFastify() ?? createFallbackApp()
}

export function registerCorsIfAvailable(app: AppInstance): void {
  try {
    const loaded = require('@fastify/cors') as { default?: unknown } | unknown
    const plugin =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : loaded
    void app.register(plugin, { origin: true })
  } catch {
    // The fallback server adds a permissive CORS header itself.
  }
}
