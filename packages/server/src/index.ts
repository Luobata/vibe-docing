import { buildApp } from './app'
import { openDb } from './db/connection'
import { ensureDatabaseDirectory, resolveDatabasePath } from './db/path'
import { createDeps } from './deps'

const databasePath = ensureDatabaseDirectory(resolveDatabasePath())
const db = openDb(databasePath)
const app = buildApp(createDeps({ db }))
const port = Number(process.env.PORT ?? 4000)

await app.listen({ host: '127.0.0.1', port })
console.log(`server on :${port}; db=${databasePath}`)
