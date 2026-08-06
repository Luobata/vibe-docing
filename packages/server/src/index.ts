import { buildApp } from './app'
import { openDb } from './db/connection'
import { createDeps } from './deps'

const db = openDb(process.env.DB_PATH ?? 'vibe.db')
const app = buildApp(createDeps({ db }))
const port = Number(process.env.PORT ?? 4000)

await app.listen({ host: '127.0.0.1', port })
console.log(`server on :${port}`)
