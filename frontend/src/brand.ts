import type { HomeSection, SiteData } from './api/site'
import { MODULE_CATALOG } from './generated/catalog.generated'

// Brand copy and the static fallback live in one place. Runtime values returned
// by /api/site override these defaults without requiring a rebuild.
const fallbackCoreSections: HomeSection[] = [
  {
    id: 1,
    kind: 'hero',
    plugin_version: 1,
    enabled: true,
    sort: 10,
    status: 'published',
    config: {
      eyebrow: '汕头职业技术学院 · 计算机协会',
      title: '把好奇心，写进每一行代码',
      subtitle: '招新答题、技术活动与同好社区，都在这里相遇。',
      primary_label: '开始答题',
      primary_to: '/quiz',
      secondary_label: '加入我们',
      secondary_to: '/join',
    },
  },
  {
    id: 2,
    kind: 'about',
    plugin_version: 1,
    enabled: true,
    sort: 20,
    status: 'published',
    config: {
      eyebrow: '关于协会',
      title: '一起学习，一起创造',
      body: '计算机协会面向所有对技术感兴趣的同学。我们用真实项目练习协作、工程与表达。',
    },
  },
  {
    id: 3,
    kind: 'activities',
    plugin_version: 1,
    enabled: true,
    sort: 30,
    status: 'published',
    config: {
      eyebrow: '持续发生',
      title: '不只是招新',
      items: [
        { title: '技术分享', body: '从 Web 开发到容器云，以能上手为目标组织分享。' },
        { title: '项目协作', body: '组队完成网站、工具与校园应用，积累可展示的作品。' },
        { title: '竞赛实践', body: '围绕真实赛题训练排障、工程化与团队配合。' },
      ],
    },
  },
]

const fallbackModuleSections: HomeSection[] = MODULE_CATALOG
  .flatMap((module) => module.sections)
  .map((raw, index) => {
    const section = raw as {
      key: string
      version: number
      home_order?: number
      default_config?: HomeSection['config']
    }
    return {
      id: 100 + index,
      kind: section.key,
      plugin_version: section.version,
      enabled: true,
      sort: section.home_order ?? 100 + index,
      status: 'published',
      config: section.default_config ?? {},
    }
  })
  .sort((a, b) => a.sort - b.sort || a.id - b.id)

const fallbackSections: HomeSection[] = [
  ...fallbackCoreSections,
  ...fallbackModuleSections,
].sort((a, b) => a.sort - b.sort || a.id - b.id)

const fallbackFeatures: SiteData['features'] = MODULE_CATALOG
  .filter((module) => module.feature)
  .map((module) => ({
    key: module.feature!,
    enabled: module.feature !== 'lottery',
    config: {},
  }))
const fallbackFeatureState = new Map(fallbackFeatures.map((feature) => [feature.key, feature.enabled]))
const fallbackModuleCardFeatures = new Map<string, string | undefined>()
for (const module of MODULE_CATALOG) {
  for (const raw of module.sections) {
    if (raw.layout !== 'module-card') continue
    const key = `${String(raw.key)}@${Number(raw.version)}`
    const feature = typeof raw.feature === 'string' ? raw.feature : module.feature
    fallbackModuleCardFeatures.set(key, feature)
  }
}

function fallbackNavigation(): SiteData['nav'] {
  const items: SiteData['nav'] = [{ label: '首页', to: '/' }]
  const seen = new Set(['/'])
  for (const section of fallbackSections) {
    const feature = fallbackModuleCardFeatures.get(
      `${section.kind}@${section.plugin_version}`,
    )
    if (feature && !fallbackFeatureState.get(feature)) continue
    const title = typeof section.config.title === 'string' ? section.config.title.trim() : ''
    const path = typeof section.config.action_to === 'string' ? section.config.action_to.trim() : ''
    if (!title || !path.startsWith('/') || path.startsWith('//') || seen.has(path)) continue
    seen.add(path)
    items.push({ label: title, to: path })
  }
  return items
}

export const FALLBACK_SITE: SiteData = {
  brand: {
    name: '计算机协会',
    short_name: 'szyca',
    description: '汕头职业技术学院计算机协会：学习、协作与创造。',
    title: '计算机协会 · 官网',
    logo_url: '',
  },
  nav: fallbackNavigation(),
  footer: {
    owner: '计算机协会 · 汕头职业技术学院',
    license: '开源协议：MIT',
    icp: '',
    icp_icon: '',
    police: '',
    police_icon: '',
    links: [
      { label: '关于协会', href: '/#about' },
      ...MODULE_CATALOG
        .filter((module) => module.footer_label && module.path)
        .sort((a, b) => (a.nav_order ?? 0) - (b.nav_order ?? 0))
        .map((module) => ({ label: module.footer_label!, href: module.path! })),
    ],
  },
  features: fallbackFeatures,
  sections: fallbackSections,
  backgrounds: [],
  qrcodes: [],
}
