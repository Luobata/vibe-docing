import type { NodeRow, RouteTarget } from '@vibe/shared'
import type { AppDeps } from '../deps'

export class MigrateNotFoundError extends Error {}
export class InvalidMigrationError extends Error {}

export interface MigrateInput {
  newParentId: string
  nodeId: string
  seedText?: string
  target: RouteTarget
}

export function createMigrateService(
  deps: Pick<AppDeps, 'clock' | 'db' | 'nodes' | 'segments'>,
) {
  function migrate(input: MigrateInput): NodeRow {
    const source = deps.nodes.get(input.nodeId)
    if (!source || source.is_deleted === 1) {
      throw new MigrateNotFoundError(`active source node not found: ${input.nodeId}`)
    }
    const newParent = deps.nodes.get(input.newParentId)
    if (!newParent || newParent.is_deleted === 1) {
      throw new MigrateNotFoundError(
        `active target node not found: ${input.newParentId}`,
      )
    }
    if (source.tree_id !== newParent.tree_id) {
      throw new InvalidMigrationError('cannot migrate across trees')
    }
    if (
      source.id === newParent.id ||
      deps.nodes
        .getPathToRoot(newParent.id)
        .some((ancestor) => ancestor.id === source.id)
    ) {
      throw new InvalidMigrationError('migration would create a cycle')
    }

    const existingSegments = deps.segments.listByNode(source.id)
    const priorSeed = existingSegments.find(
      (segment) => segment.type === 'annotation-seed',
    )?.content
    const seedText = input.seedText ?? priorSeed ?? source.user_input ?? ''
    const preservedMerges = existingSegments.filter(
      (segment) => segment.type === 'merged-conclusion',
    )

    const transaction = deps.db.transaction(() => {
      const { nextSortOrder } = deps.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order) + 1, 0) AS nextSortOrder
           FROM nodes
           WHERE parent_id = ? AND id <> ?`,
        )
        .get(newParent.id, source.id) as { nextSortOrder: number }

      deps.db
        .prepare(
          `UPDATE nodes
           SET parent_id = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(newParent.id, nextSortOrder, deps.clock.now(), source.id)

      deps.db
        .prepare(
          `DELETE FROM context_segments
           WHERE node_id = ? AND type <> 'merged-conclusion'`,
        )
        .run(source.id)

      let sequence = 0
      for (const ancestor of deps.nodes
        .getPathToRoot(newParent.id)
        .filter((node) => node.is_deleted === 0)) {
        deps.segments.add({
          nodeId: source.id,
          refNodeId: ancestor.id,
          refVersionNo: null,
          seq: sequence++,
          type: 'ancestor-full',
        })
      }
      if (input.target !== 'main-continuation') {
        deps.segments.add({
          content: seedText,
          nodeId: source.id,
          seq: sequence++,
          type: 'annotation-seed',
        })
      }

      const updateSequence = deps.db.prepare(
        'UPDATE context_segments SET seq = ? WHERE id = ?',
      )
      for (const segment of preservedMerges) {
        updateSequence.run(sequence++, segment.id)
      }
    })

    transaction()
    return deps.nodes.get(source.id)!
  }

  return { migrate }
}
