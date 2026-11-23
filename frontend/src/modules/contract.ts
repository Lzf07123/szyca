import type { ComponentType, LazyExoticComponent } from 'react'

export interface AppModuleRoute {
  path: string
  Component: LazyExoticComponent<ComponentType>
  feature?: string
  fullscreen?: boolean
}

export interface AppModuleManifest {
  key: string
  label: string
  feature?: string
  publicMetric?: boolean
  routes: readonly AppModuleRoute[]
}

export function defineAppModule<const T extends AppModuleManifest>(module: T): T {
  return module
}
