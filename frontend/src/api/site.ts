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
  key: 'quiz' | 'lottery' | 'join' | 'screen'
  enabled: boolean
  config: Record<string, unknown>
}

export interface SectionItem {
  title?: string
  body?: string
  image_url?: string
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
}

export interface HomeSection {
  id: number
  kind: 'hero' | 'about' | 'activities' | 'quiz' | 'lottery' | 'join' | 'gallery'
  enabled: boolean
  sort: number
  config: SectionConfig
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
  featureEnabled: (key: SiteFeature['key']) => boolean
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
