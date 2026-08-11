import { createContextEngine } from './context/context-engine'
import type { Db } from './db/connection'
import type { Provider } from './provider/types'
import { createAnnotationRepo } from './repo/annotation-repo'
import { createMergeRepo } from './repo/merge-repo'
import { createNodeRepo } from './repo/node-repo'
import { createSegmentRepo } from './repo/segment-repo'
import { createSettingsRepo } from './repo/settings-repo'
import { createShareRepo } from './repo/share-repo'
import { createTreeRepo } from './repo/tree-repo'
import { createVersionRepo } from './repo/version-repo'
import { createVisualArtifactRepo } from './repo/visual-artifact-repo'
import { createAnswerService } from './service/answer-service'
import { createShareService } from './service/share-service'
import { systemClock, type Clock } from './util/clock'

export interface AppDeps {
  annotations: ReturnType<typeof createAnnotationRepo>
  answer: ReturnType<typeof createAnswerService>
  clock: Clock
  context: ReturnType<typeof createContextEngine>
  db: Db
  merges: ReturnType<typeof createMergeRepo>
  nodes: ReturnType<typeof createNodeRepo>
  providerOverride?: Provider
  segments: ReturnType<typeof createSegmentRepo>
  settings: ReturnType<typeof createSettingsRepo>
  share: ReturnType<typeof createShareService>
  shares: ReturnType<typeof createShareRepo>
  trees: ReturnType<typeof createTreeRepo>
  versions: ReturnType<typeof createVersionRepo>
  visualArtifacts: ReturnType<typeof createVisualArtifactRepo>
}

export function createDeps(options: { clock?: Clock; db: Db }): AppDeps {
  const clock = options.clock ?? systemClock
  const nodes = createNodeRepo(options.db, clock)
  const segments = createSegmentRepo(options.db)
  const versions = createVersionRepo(options.db, clock)
  const context = createContextEngine({ nodes, segments, versions })
  const settings = createSettingsRepo(options.db)
  const shares = createShareRepo(options.db, clock)
  const visualArtifacts = createVisualArtifactRepo(options.db, clock)

  return {
    annotations: createAnnotationRepo(options.db, clock),
    answer: createAnswerService({ nodes, segments, settings, versions, visualArtifacts }),
    clock,
    context,
    db: options.db,
    merges: createMergeRepo(options.db, clock),
    nodes,
    segments,
    settings,
    share: createShareService(options.db, shares, visualArtifacts),
    shares,
    trees: createTreeRepo(options.db, clock),
    versions,
    visualArtifacts,
  }
}
