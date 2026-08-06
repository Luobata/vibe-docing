import { createApi, type Api } from './api/client'
import { ApiProvider } from './api/context'
import { Workbench } from './components/Workbench'

const defaultApi = createApi()

export function App({ api = defaultApi }: { api?: Api }) {
  return <ApiProvider api={api}><Workbench /></ApiProvider>
}
