import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { FALLBACK_SITE } from '../brand'
import { api } from './client'

export interface Brand {
  name: string
  short_name: string
  description: string
  title: string
  logo_url: string
}

export interface NavItem {
  label: string
  to: string
}

export interface FooterLink {
  label: string
  href: string
}

export interface FooterSettings {
  owner: string
  license: string
  icp: string
  icp_icon: string
  police: string
  police_icon: string
  links: FooterLink[]
}

export interface SiteFeature {
  key: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface SectionItem {
  title?: string
  body?: string
  image_url?: string
  [key: string]: unknown
}

export interface SectionConfig {
  eyebrow?: string
  title?: string
  subtitle?: string
  body?: string
  primary_label?: string
  primary_to?: string
  secondary_label?: string
  secondary_to?: string
  action_label?: string
  action_to?: string
  items?: SectionItem[]
  [key: string]: unknown
}

export type SectionPluginFieldType = 'text' | 'textarea' | 'path' | 'items'

export interface SectionPluginField {
  key: string
  label: string
  type: SectionPluginFieldType
  group?: string
  group_label?: string
  group_description?: string
  description?: string
  placeholder?: string
  max_length?: number
  max_items?: number
  item_fields?: SectionPluginField[]
}

export interface SectionPluginManifest {
  key: string
  version: number
  scope: 'home'
  label: string
  description: string
  feature?: SiteFeature['key']
  repeatable: boolean
  max_instances: number
  summary_field?: string
  default_config: SectionConfig
  fields: SectionPluginField[]
}

export interface SiteGalleryImage {
  id: number
  section_id: number
  title: string
  image_url: string
  sort: number
  created_at: string
  updated_at: string
}

export interface HomeSection {
  id: number
  kind: string
  plugin_version: number
  enabled: boolean
  sort: number
  config: SectionConfig
  gallery?: SiteGalleryImage[]
  status: string
}

export interface SiteBackground {
  id: number
  path: string
}

export interface SiteQrcode {
  id: number
  title: string
  image_url: string
}

export interface SitePage {
  slug: string
  title: string
  summary: string
  body: string
  status: 'draft' | 'published' | 'archived'
  published_at?: string
  updated_at: string
}

export interface SiteData {
  brand: Brand
  nav: NavItem[]
  footer: FooterSettings
  features: SiteFeature[]
  sections: HomeSection[]
  backgrounds: SiteBackground[]
  qrcodes: SiteQrcode[]
}

interface SiteContextValue {
  site: SiteData
  loading: boolean
  error: string
  reload: () => Promise<void>
  featureEnabled: (key: string) => boolean
}

const SiteContext = createContext<SiteContextValue | null>(null)

export function setFavicon(url: string) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!url) {
    if (link?.dataset.auto === '1') link.remove()
    return
  }
  const element = link ?? document.createElement('link')
  element.rel = 'icon'
  element.dataset.auto = '1'
  element.href = url
  if (!element.parentNode) document.head.appendChild(element)
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteData>(FALLBACK_SITE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await api<SiteData>('/api/site')
      setSite(next)
      setError('')
      setFavicon(next.brand.logo_url)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<SiteContextValue>(
    () => ({
      site,
      loading,
      error,
      reload,
      featureEnabled: (key) => site.features.find((feature) => feature.key === key)?.enabled ?? false,
    }),
    [site, loading, error, reload],
  )

  return createElement(SiteContext.Provider, { value }, children)
}

export function useSite(): SiteContextValue {
  const context = useContext(SiteContext)
  if (!context) throw new Error('useSite must be used inside SiteProvider')
  return context
}

export function useLogoURL(): string {
  return useSite().site.brand.logo_url
}
