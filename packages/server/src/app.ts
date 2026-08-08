import {
  createAppInstance,
  registerCorsIfAvailable,
  type AppInstance,
} from './http/app-instance'
import { openMemoryDb } from './db/connection'
import { createDeps, type AppDeps } from './deps'
import { registerTreeRoutes } from './routes/trees'
import { registerForkRoutes } from './routes/fork'
import { registerAnswerRoutes } from './routes/answer'
import { registerNodeEditRoutes } from './routes/node-edit'
import { registerVersionRoutes } from './routes/versions'
import { registerTrashRoutes } from './routes/trash'
import { registerRouteConvergeRoutes } from './routes/route-converge'
import { registerMigrateRoutes } from './routes/migrate'
import { registerMergeRoutes } from './routes/merge'
import { registerAnnotationRoutes } from './routes/annotation'
import { registerSettingsRoutes } from './routes/settings'

export type DecoratedApp = AppInstance & { deps: AppDeps }

export function buildApp(deps?: AppDeps): DecoratedApp {
  const app = createAppInstance() as DecoratedApp

  registerCorsIfAvailable(app)
  app.decorate('deps', deps ?? createDeps({ db: openMemoryDb() }))
  app.get('/health', async () => ({ ok: true }))
  registerTreeRoutes(app)
  registerForkRoutes(app)
  registerAnswerRoutes(app)
  registerNodeEditRoutes(app)
  registerVersionRoutes(app)
  registerTrashRoutes(app)
  registerRouteConvergeRoutes(app)
  registerMigrateRoutes(app)
  registerMergeRoutes(app)
  registerAnnotationRoutes(app)
  registerSettingsRoutes(app)

  return app
}
