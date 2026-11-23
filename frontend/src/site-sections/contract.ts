import type { ComponentType } from 'react'
import type {
  HomeSection,
  SectionConfig,
  SectionItem,
  SectionPluginManifest,
} from '../api/site'

export type SectionLayout = 'block' | 'module-card'

export interface SectionRenderContext {
  instanceIndex: number
  ordinal: number
  backgrounds: string[]
  moduleCount: number
  questionCount: number | null
  uptimeSeconds: number | null
  uptimeStartedAt: string | null
  featureEnabled: (key: string) => boolean
}

export interface SectionRendererProps {
  section: HomeSection
  context: SectionRenderContext
}

export interface SectionEditorProps {
  section: HomeSection
  plugin: SectionPluginManifest
  canWrite: boolean
  updateConfig: (key: string, value: unknown) => void
  updateItems: (key: string, items: SectionItem[]) => void
  onChanged: () => Promise<void>
}

export interface SectionFrontendPlugin {
  key: string
  version: number
  layout: SectionLayout
  Renderer: ComponentType<SectionRendererProps>
  Editor?: ComponentType<SectionEditorProps>
}

export function defineSectionPlugin<const T extends SectionFrontendPlugin>(plugin: T): T {
  return plugin
}

export function sectionConfigText(config: SectionConfig, key: string): string {
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

export function sectionConfigItems(config: SectionConfig, key = 'items'): SectionItem[] {
  const value = config[key]
  return Array.isArray(value)
    ? value.filter((item): item is SectionItem => Boolean(item) && typeof item === 'object')
    : []
}

export function sectionAnchor(
  base: string,
  section: HomeSection,
  context: SectionRenderContext,
): string {
  return context.instanceIndex === 0 ? base : `${base}-${section.id}`
}
