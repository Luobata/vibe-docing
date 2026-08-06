import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const schema = readFileSync(join(currentDirectory, 'schema.sql'), 'utf8')

export type Db = Database.Database

export function openDb(path: string): Db {
  const db = new Database(path)

  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(schema)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function openMemoryDb(): Db {
  return openDb(':memory:')
}
