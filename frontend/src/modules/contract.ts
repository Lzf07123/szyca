import type { ComponentType, LazyExoticComponent } from 'react'
import type { SectionFrontendPlugin } from '../site-sections/contract'

export interface AdminRuntimeContext {
  can: (permission: string) => boolean
  notify: (message: string, error?: boolean) => void
  reloadSite: () => Promise<void>
  setQuizState: (state: 'start' | 'stop') => void
}

export interface AdminPanelProps {
  context: AdminRuntimeContext
}

export interface AdminPanelContribution {
  key: string
  tab: string
  permission: string
  order: number
  Component: ComponentType<AdminPanelProps>
}

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
  internal?: boolean
  routes: readonly AppModuleRoute[]
}

export interface AppModuleRuntime {
  manifest: AppModuleManifest
  sections?: readonly SectionFrontendPlugin[]
  adminPanels?: readonly AdminPanelContribution[]
}

export function defineAppModule<const T extends AppModuleManifest>(module: T): T {
  return module
}
