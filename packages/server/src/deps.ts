import { createContextEngine } from './context/context-engine'
import type { Db } from './db/connection'
import type { Provider } from './provider/types'
import { createAnnotationRepo } from './repo/annotation-repo'
import { createMergeRepo } from './repo/merge-repo'
import { createNodeRepo } from './repo/node-repo'
import { createSegmentRepo } from './repo/segment-repo'
import { createSettingsRepo } from './repo/settings-repo'
import { createTreeRepo } from './repo/tree-repo'
import { createVersionRepo } from './repo/version-repo'
import { createAnswerService } from './service/answer-service'
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
  trees: ReturnType<typeof createTreeRepo>
  versions: ReturnType<typeof createVersionRepo>
}

export function createDeps(options: { clock?: Clock; db: Db }): AppDeps {
  const clock = options.clock ?? systemClock
  const nodes = createNodeRepo(options.db, clock)
  const segments = createSegmentRepo(options.db)
  const versions = createVersionRepo(options.db, clock)
  const context = createContextEngine({ nodes, segments, versions })

  return {
    annotations: createAnnotationRepo(options.db, clock),
    answer: createAnswerService({ nodes, segments, versions }),
    clock,
    context,
    db: options.db,
    merges: createMergeRepo(options.db, clock),
    nodes,
    segments,
    settings: createSettingsRepo(options.db),
    trees: createTreeRepo(options.db, clock),
    versions,
  }
}
