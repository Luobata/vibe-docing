import { validateVisualArtifact, type VisualArtifact, type VisualArtifactRow } from '@vibe/shared'
import type { Db } from '../db/connection'
import type { Clock } from '../util/clock'

export function createVisualArtifactRepo(db: Db, clock: Clock) {
  function fromRow(row: VisualArtifactRow | undefined): VisualArtifact | undefined {
    if (!row) return undefined
    let value: unknown
    try { value = JSON.parse(row.scene_json) } catch { throw new Error(`Stored visual artifact is not valid JSON: ${row.artifact_id}@${row.revision}`) }
    const result = validateVisualArtifact(value)
    if (!result.success) throw new Error(`Stored visual artifact is invalid: ${result.errors.join('; ')}`)
    return result.value
  }

  function get(artifactId: string, revision: number): VisualArtifact | undefined {
    return fromRow(db.prepare('SELECT * FROM visual_artifacts WHERE artifact_id = ? AND revision = ?').get(artifactId, revision) as VisualArtifactRow | undefined)
  }

  function getLatest(artifactId: string): VisualArtifact | undefined {
    return fromRow(db.prepare('SELECT * FROM visual_artifacts WHERE artifact_id = ? ORDER BY revision DESC LIMIT 1').get(artifactId) as VisualArtifactRow | undefined)
  }

  function create(value: unknown): VisualArtifact {
    const result = validateVisualArtifact(value)
    if (!result.success) throw new Error(`Invalid visual artifact: ${result.errors.join('; ')}`)
    const artifact = result.value
    const existing = get(artifact.artifactId, artifact.revision)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(artifact)) throw new Error(`Visual artifact revision already exists with different content: ${artifact.artifactId}@${artifact.revision}`)
      return existing
    }
    const now = clock.now()
    db.prepare(`INSERT INTO visual_artifacts (
      artifact_id, revision, kind, title, alt_text, renderer, schema_version, scene_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      artifact.artifactId, artifact.revision, artifact.kind, artifact.title, artifact.altText,
      artifact.renderer, artifact.schemaVersion, JSON.stringify(artifact), now, now,
    )
    return get(artifact.artifactId, artifact.revision)!
  }

  return { create, get, getLatest }
}
