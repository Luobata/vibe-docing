import { createContext, useContext, type ReactNode } from 'react'
import { createApi, type Api } from './client'

const ApiContext = createContext<Api>(createApi())

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): Api {
  return useContext(ApiContext)
}
