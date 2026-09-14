import {
  createAppInstance,
  registerCorsIfAvailable,
  type AppInstance,
} from './http/app-instance'
import { openMemoryDb } from './db/connection'
import { createDeps, type AppDeps } from './deps'
import { registerTreeRoutes } from './routes/trees'
import { registerFolderRoutes } from './routes/folders'
import { registerForkRoutes } from './routes/fork'
import { registerAnswerRoutes } from './routes/answer'
import { registerNodeEditRoutes } from './routes/node-edit'
import { registerVersionRoutes } from './routes/versions'
import { registerTrashRoutes } from './routes/trash'
import { registerRouteConvergeRoutes } from './routes/route-converge'
import { registerMigrateRoutes } from './routes/migrate'
import { registerMergeRoutes } from './routes/merge'
import { registerCorrectRoutes } from './routes/correct'
import { registerAnnotationRoutes } from './routes/annotation'
import { registerSettingsRoutes } from './routes/settings'
import { registerSearchRoutes } from './routes/search'
import { registerShareRoutes } from './routes/share'
import { registerVisualArtifactRoutes } from './routes/visual-artifacts'
import { registerDocumentContentRoutes } from './routes/document-content'
import { registerVaultRoutes } from './routes/vault'
import { registerSystemRoutes } from './routes/system'
import { registerSynthesisRoutes } from './routes/synthesis'
import { registerMaterialRoutes } from './routes/materials'
import { registerDiscussionRoutes } from './routes/discussion'

export type DecoratedApp = AppInstance & { deps: AppDeps }

export function buildApp(deps?: AppDeps): DecoratedApp {
  const app = createAppInstance() as DecoratedApp

  registerCorsIfAvailable(app)
  app.decorate('deps', deps ?? createDeps({ db: openMemoryDb() }))
  app.get('/health', async () => ({ ok: true }))
  registerTreeRoutes(app)
  registerFolderRoutes(app)
  registerForkRoutes(app)
  registerAnswerRoutes(app)
  registerDiscussionRoutes(app)
  registerSynthesisRoutes(app)
  registerMaterialRoutes(app)
  registerNodeEditRoutes(app)
  registerDocumentContentRoutes(app)
  registerVaultRoutes(app)
  registerSystemRoutes(app)
  registerVersionRoutes(app)
  registerTrashRoutes(app)
  registerRouteConvergeRoutes(app)
  registerMigrateRoutes(app)
  registerMergeRoutes(app)
  registerCorrectRoutes(app)
  registerAnnotationRoutes(app)
  registerSettingsRoutes(app)
  registerSearchRoutes(app)
  registerShareRoutes(app)
  registerVisualArtifactRoutes(app)

  return app
}
