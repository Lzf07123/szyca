import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useSite, type HomeSection } from '../api/site'
import CustomCursor from '../components/CustomCursor'
import PageMeta from '../components/PageMeta'
import type { SectionFrontendPlugin, SectionRenderContext } from '../site-sections/contract'
import { getSectionPlugin } from '../site-sections/registry'

interface GroupedCard {
  key: string
  section: HomeSection
  Renderer: SectionFrontendPlugin['Renderer']
}

function ModuleSectionGroup({
  sections,
  makeContext,
}: {
  sections: HomeSection[]
  makeContext: (section: HomeSection, ordinal?: number) => SectionRenderContext
}) {
  const cards: GroupedCard[] = []
  for (const section of sections) {
    const plugin = getSectionPlugin(section.kind, section.plugin_version)
    if (plugin?.layout !== 'module-card') continue
    cards.push({ key: `section-${section.id}`, section, Renderer: plugin.Renderer })
  }
  if (cards.length === 0) return null

  return (
    <section className="modules-section" aria-labelledby="modules-title">
      <div className="modules-heading" data-reveal>
        <div>
          <p className="section-command"><span>$</span> ls ./modules</p>
          <h2 id="modules-title">核心模块 <span>MODULES</span></h2>
        </div>
        <p>一次作答，一条榜线，一群愿意一起把想法做成作品的人。</p>
      </div>
      <div className="module-grid">
        {cards.map((card, index) => {
          const ordinal = index + 1
          const Renderer = card.Renderer
          return (
            <Renderer
              key={card.key}
              section={card.section}
              context={makeContext(card.section, ordinal)}
            />
          )
        })}
      </div>
    </section>
  )
}

export default function Home() {
  const { site, featureEnabled } = useSite()
  const [uptimeSeconds, setUptimeSeconds] = useState<number | null>(null)
  const [uptimeStartedAt, setUptimeStartedAt] = useState<string | null>(null)
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const sections = [...site.sections]
    .filter((section) => section.enabled)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
  const moduleSections = sections.filter((section) => (
    getSectionPlugin(section.kind, section.plugin_version)?.layout === 'module-card'
  ))
  const firstModuleSectionID = moduleSections[0]?.id
  const backgrounds = site.backgrounds.map((background) => background.path)
  const moduleCount = moduleSections.length

  useEffect(() => {
    let alive = true
    let baseSeconds: number | null = null
    let syncedAt = 0
    const syncUptime = () => {
      void api<{ uptime_seconds: number; started_at: string }>('/api/runtime')
        .then((runtime) => {
          if (alive && Number.isFinite(runtime.uptime_seconds)) {
            baseSeconds = runtime.uptime_seconds
            syncedAt = Date.now()
            setUptimeSeconds(baseSeconds)
            setUptimeStartedAt(runtime.started_at || null)
          }
        })
        .catch(() => undefined)
    }
    syncUptime()
    const syncTimer = window.setInterval(syncUptime, 60_000)
    const tickTimer = window.setInterval(() => {
      if (baseSeconds === null) return
      setUptimeSeconds(baseSeconds + Math.floor((Date.now() - syncedAt) / 1000))
    }, 1000)
    return () => {
      alive = false
      window.clearInterval(syncTimer)
      window.clearInterval(tickTimer)
    }
  }, [])

  useEffect(() => {
    if (!featureEnabled('quiz')) {
      setQuestionCount(null)
      return
    }
    let alive = true
    const syncQuestions = () => {
      void api<{ questions: number }>('/api/stats')
        .then((stats) => {
          if (alive && Number.isFinite(stats.questions)) setQuestionCount(stats.questions)
        })
        .catch(() => undefined)
    }
    syncQuestions()
    const timer = window.setInterval(syncQuestions, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [featureEnabled])

  const instanceIndexes = new Map<string, number>()
  const contexts = new Map<number, SectionRenderContext>()
  sections.forEach((section, index) => {
    const instanceIndex = instanceIndexes.get(section.kind) ?? 0
    instanceIndexes.set(section.kind, instanceIndex + 1)
    contexts.set(section.id, {
      instanceIndex,
      ordinal: index + 1,
      backgrounds,
      moduleCount,
      questionCount,
      uptimeSeconds,
      uptimeStartedAt,
      featureEnabled,
    })
  })
  const makeContext = (section: HomeSection, ordinal?: number): SectionRenderContext => {
    const context = contexts.get(section.id)
    if (!context) {
      return {
        instanceIndex: 0,
        ordinal: ordinal ?? 1,
        backgrounds,
        moduleCount,
        questionCount,
        uptimeSeconds,
        uptimeStartedAt,
        featureEnabled,
      }
    }
    return ordinal === undefined ? context : { ...context, ordinal }
  }

  return (
    <>
      <CustomCursor />
      <PageMeta
        title={site.brand.title || `${site.brand.name} · 数字深空`}
        description={site.brand.description}
      />
      <div className="site-home cosmic-home">
        {sections.map((section) => {
          const plugin = getSectionPlugin(section.kind, section.plugin_version)
          if (!plugin) return null
          if (plugin.layout === 'module-card') {
            if (section.id !== firstModuleSectionID) return null
            return (
              <ModuleSectionGroup
                key={`modules-${section.id}`}
                sections={moduleSections}
                makeContext={makeContext}
              />
            )
          }
          return (
            <plugin.Renderer
              key={section.id}
              section={section}
              context={makeContext(section)}
            />
          )
        })}
        {sections.length === 0 && (
          <section className="state-page" role="status">
            <p className="eyebrow">SITE / STANDBY</p>
            <h1>首页内容正在准备</h1>
            <p>管理员启用并发布首页模块后，这里会自动展示最新内容。</p>
          </section>
        )}
      </div>
    </>
  )
}
