import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import CustomCursor from '../components/CustomCursor'
import PageMeta from '../components/PageMeta'
import ScrambleText from '../components/ScrambleText'
import {
  useSite,
  type HomeSection,
  type SiteFeature,
} from '../api/site'

function canVisit(path: string | undefined, enabled: (key: SiteFeature['key']) => boolean): path is string {
  if (!path?.startsWith('/')) return false
  if (path.startsWith('/quiz')) return enabled('quiz')
  if (path.startsWith('/lottery')) return enabled('lottery')
  if (path.startsWith('/join')) return enabled('join')
  if (path.startsWith('/screen')) return enabled('screen')
  return true
}

function splitTitle(title: string) {
  const parts = title.match(/[^，。！？]+[，。！？]?/g) ?? [title]
  return parts.length > 2 ? [parts.slice(0, -1).join(''), parts[parts.length - 1] || ''] : parts
}

function useHeroParallax(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const hero = ref.current
    if (!hero) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      hero.style.setProperty('--hero-bg-shift', '0px')
      hero.style.setProperty('--hero-mid-shift', '0px')
      hero.style.setProperty('--hero-fg-shift', '0px')
      return
    }

    let frame = 0
    const update = () => {
      frame = 0
      const rect = hero.getBoundingClientRect()
      const travel = Math.max(hero.offsetHeight, 1)
      const progress = Math.min(1, Math.max(0, -rect.top / travel))
      const strength = window.innerWidth <= 820 ? 0.42 : 1
      hero.style.setProperty('--hero-bg-shift', `${progress * 44 * strength}px`)
      hero.style.setProperty('--hero-mid-shift', `${progress * 24 * strength}px`)
      hero.style.setProperty('--hero-fg-shift', `${progress * -14 * strength}px`)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [ref])
}

function clockText(totalSeconds: number) {
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function daysInMonthUTC(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function addCalendarYears(date: Date, years: number) {
  const year = date.getUTCFullYear() + years
  const month = date.getUTCMonth()
  return new Date(Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), daysInMonthUTC(year, month)),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ))
}

function addCalendarMonths(date: Date, months: number) {
  const monthIndex = date.getUTCMonth() + months
  const year = date.getUTCFullYear() + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  return new Date(Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), daysInMonthUTC(year, month)),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ))
}

function formatUptime(seconds: number | null, startedAt: string | null) {
  if (seconds === null) return '--'
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const days = Math.floor(totalSeconds / 86400)
  if (totalSeconds < 30 * 86400) {
    const clock = clockText(totalSeconds)
    return days > 0 ? `${days}d ${clock}` : clock
  }

  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  if (!Number.isFinite(startedMs)) {
    return `${days}d ${clockText(totalSeconds)}`
  }

  const start = new Date(startedMs)
  const end = new Date(startedMs + totalSeconds * 1000)
  let years = 0
  while (addCalendarYears(start, years + 1).getTime() <= end.getTime()) years += 1
  let cursor = addCalendarYears(start, years)
  let months = 0
  while (months < 12 && addCalendarMonths(cursor, months + 1).getTime() <= end.getTime()) months += 1
  cursor = addCalendarMonths(cursor, months)
  const remainderSeconds = Math.max(0, Math.floor((end.getTime() - cursor.getTime()) / 1000))
  const remainderDays = Math.floor(remainderSeconds / 86400)
  const clock = clockText(remainderSeconds)
  return `${years}年 ${months}月 ${remainderDays}日 ${clock}`
}

type ModuleKind = 'quiz' | 'rank' | 'join'

function ModuleIcon({ kind }: { kind: ModuleKind }) {
  if (kind === 'quiz') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4.5h14v15H5z" />
        <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
        <path d="m15.5 16.5 1.3 1.2 2.3-2.5" />
      </svg>
    )
  }
  if (kind === 'rank') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 19.5h15" />
        <path d="M6.5 16V11h3v5M10.5 16V6h3v10M14.5 16V8.5h3V16" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 13.5a4 4 0 1 1 2-3.1l2.5-2.5 2.2 2.2-2.5 2.5a4 4 0 0 1-3.2 4 4 4 0 0 1-1-3.1Z" />
      <path d="m16 5 3 3M14.5 6.5l3 3M5 19l5-5" />
    </svg>
  )
}

function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  )
}

function Hero({
  section,
  primaryTo,
  secondaryTo,
  backgrounds,
  moduleCount,
  questionCount,
  uptimeSeconds,
  uptimeStartedAt,
}: {
  section: HomeSection
  primaryTo?: string
  secondaryTo?: string
  backgrounds: string[]
  moduleCount: number
  questionCount: number | null
  uptimeSeconds: number | null
  uptimeStartedAt: string | null
}) {
  const config = section.config
  const title = config.title || '把好奇心，写进每一行代码'
  const lines = splitTitle(title)
  const uptimeIsLong = uptimeSeconds !== null && uptimeSeconds >= 30 * 86400
  const heroRef = useRef<HTMLElement>(null)
  useHeroParallax(heroRef)

  return (
    <section ref={heroRef} className="home-hero cosmic-hero" aria-labelledby="hero-title">
      <div className="hero-copy" data-parallax="foreground">
        <div className="hero-kicker" data-reveal>
          <span className="signal-dot" aria-hidden="true" />
          <span>STPT · COMPUTER ASSOCIATION</span>
          <span className="kicker-index">SYS / 001</span>
        </div>
        <p className="boot-command" data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
          <span aria-hidden="true">&gt;</span> boot nebula_os ... <b>[OK]</b><i className="terminal-cursor" aria-hidden="true">▊</i>
        </p>
        <h1
          id="hero-title"
          aria-label={title}
          data-reveal
          style={{ '--reveal-delay': '140ms' } as CSSProperties}
        >
          {lines.map((line, index) => (
            <span className="hero-title-line" aria-hidden="true" key={`${line}-${index}`}>
              <ScrambleText text={line} delay={index * 55} />
            </span>
          ))}
        </h1>
        <p className="hero-subtitle" data-reveal style={{ '--reveal-delay': '220ms' } as CSSProperties}>
          {config.subtitle || '招新答题、技术活动与同好社区，都在这里相遇。'}
        </p>
        <div className="hero-actions" data-reveal style={{ '--reveal-delay': '300ms' } as CSSProperties}>
          {primaryTo && config.primary_label && (
            <Link className="btn btn-primary" to={primaryTo}>
              {config.primary_label}
              <Arrow />
            </Link>
          )}
          {secondaryTo && config.secondary_label && (
            <Link className="btn btn-secondary" to={secondaryTo}>
              {config.secondary_label}
            </Link>
          )}
        </div>
        <dl className="hero-facts" data-reveal style={{ '--reveal-delay': '380ms' } as CSSProperties}>
          <div><dt>{String(moduleCount).padStart(2, '0')}</dt><dd>启用模块 / MODULES</dd></div>
          <div><dt>{questionCount === null ? '--' : questionCount.toLocaleString('zh-CN')}</dt><dd>开放题目 / QUESTIONS</dd></div>
          <div className={uptimeIsLong ? 'uptime-fact is-long' : 'uptime-fact'}>
            <dt>{formatUptime(uptimeSeconds, uptimeStartedAt)}</dt>
            <dd>系统在线 / UPTIME</dd>
          </div>
        </dl>
      </div>

      <div className="hero-visual" data-reveal style={{ '--reveal-delay': '180ms' } as CSSProperties} role="group" aria-label="NEBULA OS 启动终端">
        {backgrounds[0] && (
          <img
            className="hero-photo"
            data-parallax="background"
            src={backgrounds[0]}
            alt=""
            loading="eager"
          />
        )}
        <div className="hero-grid" data-parallax="background" aria-hidden="true" />
        <span className="hero-coordinate hero-coordinate-a" data-parallax="midground" aria-hidden="true">NET / 90 NODES</span>
        <span className="hero-coordinate hero-coordinate-b" data-parallax="midground" aria-hidden="true">GRID / 56 PX</span>
        <div className="terminal-card" data-parallax="midground">
          <div className="terminal-bar">
            <i /><i /><i />
            <span>nebula_os://boot</span>
          </div>
          <div className="terminal-body">
            <p><span className="terminal-prompt">&gt;</span> boot nebula_os ... <b>[OK]</b><i className="terminal-cursor" aria-hidden="true">▊</i></p>
            <p><span className="terminal-dim">[ok]</span> kernel / curiosity</p>
            <p><span className="terminal-dim">[ok]</span> network / collaboration</p>
            <p><span className="terminal-dim">[ok]</span> canvas / 090 nodes</p>
            <p className="terminal-gap"><span className="terminal-prompt">&gt;</span> whoami</p>
            <p className="terminal-result">computer_association</p>
            <p className="terminal-json">
              <span>{'{'}</span><br />
              &nbsp;&nbsp;build: <em>community</em>,<br />
              &nbsp;&nbsp;status: <em>exploring</em><br />
              <span>{'}'}</span>
            </p>
          </div>
          <div className="terminal-signal">
            <span>SIGNAL_ESTABLISHED</span>
            <b>00:00:01</b>
          </div>
        </div>
        <div className="signal-orbit" data-parallax="midground" aria-hidden="true" />
      </div>
    </section>
  )
}

function Whoami({ section, activities }: { section?: HomeSection; activities?: HomeSection }) {
  const config = section?.config
  return (
    <section className="whoami-section" id="about" data-reveal>
      <div className="command-line">
        <span className="command-prompt">$</span> whoami
        <span className="command-arrow" aria-hidden="true">→</span>
        <b>关于我们</b>
      </div>
      <div className="whoami-grid">
        <div>
          <p className="section-label">WHO ARE WE / 01</p>
          <h2>{config?.title || '一起学习，一起创造'}</h2>
        </div>
        <div className="whoami-copy">
          <p>{config?.body || '计算机协会面向所有对技术感兴趣的同学。我们用真实项目练习协作、工程与表达。'}</p>
          {activities?.config.items?.length ? (
            <ul className="whoami-tags" aria-label="协会活动类型">
              {activities.config.items.slice(0, 3).map((item) => (
                <li key={item.title}>{item.title}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="whoami-status" aria-label="协会状态">
          <div><span>STATUS</span><b>OPEN</b></div>
          <div><span>MODE</span><b>BUILD TOGETHER</b></div>
          <div><span>SIGNAL</span><b>LIVE</b></div>
        </div>
      </div>
    </section>
  )
}

function Modules({
  quiz,
  join,
  featureEnabled,
}: {
  quiz?: HomeSection
  join?: HomeSection
  featureEnabled: (key: SiteFeature['key']) => boolean
}) {
  const modules: Array<{
    kind: ModuleKind
    number: string
    title: string
    english: string
    description: string
    to: string
    enabled: boolean
  }> = [
    {
      kind: 'quiz',
      number: '01',
      title: quiz?.config.title?.replace('招新', '') || '答题中心',
      english: 'QUIZ',
      description: quiz?.config.body || '选择难度，完成一轮答题，实时查看成绩与排名。',
      to: quiz?.config.action_to || '/quiz',
      enabled: featureEnabled('quiz'),
    },
    {
      kind: 'rank',
      number: '02',
      title: '实时排行',
      english: 'RANK',
      description: '成绩与名次实时更新，在共同时区里看见每一次进步。',
      to: '/screen',
      enabled: featureEnabled('screen'),
    },
    {
      kind: 'join',
      number: '03',
      title: join?.config.title || '加入我们',
      english: 'JOIN',
      description: join?.config.body || '扫码加入招新群，不错过下一场活动与协作。',
      to: join?.config.action_to || '/join',
      enabled: featureEnabled('join'),
    },
  ]
  const visible = modules.filter((module) => module.enabled)

  return (
    <section className="modules-section" aria-labelledby="modules-title">
      <div className="modules-heading" data-reveal>
        <div>
          <p className="section-command"><span>$</span> ls ./modules</p>
          <h2 id="modules-title">核心模块 <span>MODULES</span></h2>
        </div>
        <p>从一次作答开始，抵达榜线、同好与下一件作品。</p>
      </div>
      <div className="module-grid">
        {visible.map((module, index) => (
          <article
            className={`module-card module-${module.kind}`}
            data-reveal
            key={module.kind}
            style={{ '--reveal-delay': `${index * 120}ms` } as CSSProperties}
          >
            <Link to={module.to} aria-label={`进入${module.title}模块`}>
              <div className="module-topline">
                <span className="module-number">[{module.number}]</span>
                <span className="module-index">NEBULA / {module.english}</span>
              </div>
              <div className="module-icon"><ModuleIcon kind={module.kind} /></div>
              <div className="module-copy">
                <p>{module.english} / MODULE</p>
                <h3>{module.title} <span>{module.english}</span></h3>
                <p className="module-description">{module.description}</p>
              </div>
              <span className="module-open">OPEN MODULE <Arrow /></span>
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}

function LotterySignal({
  section,
  enabled,
}: {
  section?: HomeSection
  enabled: boolean
}) {
  if (!enabled || !section) return null
  const config = section.config
  return (
    <aside className="lottery-signal" id="lottery" data-reveal>
      <div className="lottery-signal-meta">
        <span>[EVENT / 04]</span>
        <span>SIGNAL DETECTED</span>
      </div>
      <div>
        <p className="section-label">LIVE EVENT / 现场福利</p>
        <h2>{config.title || '招新抽奖'}</h2>
        <p>{config.body || '完成一轮答题即可参与，结果由服务端公平生成。'}</p>
      </div>
      <Link className="btn btn-secondary" to={config.action_to || '/lottery'}>
        {config.action_label || '查看活动'}
        <Arrow />
      </Link>
    </aside>
  )
}

function Gallery({ section }: { section: HomeSection }) {
  const config = section.config
  const images = (config.items || []).filter((item) => item.image_url)
  return (
    <section className="home-section gallery-section" aria-labelledby="gallery-title" data-reveal>
      <div className="section-heading">
        <div>
          <p className="section-label">{config.eyebrow || 'FIELD NOTES / 活动影像'}</p>
          <h2 id="gallery-title">{config.title || '协会现场'}</h2>
        </div>
        <p>{config.body || config.subtitle || '技术分享、比赛与协作时刻。'}</p>
      </div>
      {images.length > 0 ? (
        <div className="gallery-grid">
          {images.slice(0, 4).map((item, index) => (
            <figure className={`gallery-item gallery-item-${index + 1}`} key={`${item.image_url}-${index}`}>
              <img
                src={item.image_url}
                alt={item.title || `协会活动照片 ${index + 1}`}
                loading="lazy"
              />
            </figure>
          ))}
        </div>
      ) : (
        <div className="gallery-empty">
          <span>[ GALLERY / PENDING ]</span>
          <p>活动照片正在整理，下一次现场见。</p>
        </div>
      )}
    </section>
  )
}

export default function Home() {
  const { site, featureEnabled } = useSite()
  const [uptimeSeconds, setUptimeSeconds] = useState<number | null>(null)
  const [uptimeStartedAt, setUptimeStartedAt] = useState<string | null>(null)
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const sections = [...site.sections].filter((section) => section.enabled).sort((a, b) => a.sort - b.sort)
  const hero = sections.find((section) => section.kind === 'hero')
  const about = sections.find((section) => section.kind === 'about')
  const activities = sections.find((section) => section.kind === 'activities')
  const quiz = sections.find((section) => section.kind === 'quiz')
  const lottery = sections.find((section) => section.kind === 'lottery')
  const join = sections.find((section) => section.kind === 'join')
  const moduleAnchor = sections.find((section) => section.kind === 'quiz' || section.kind === 'join')?.id
  const backgrounds = site.backgrounds.map((background) => background.path)
  const primaryTo = canVisit(hero?.config.primary_to, featureEnabled)
    ? hero?.config.primary_to
    : featureEnabled('quiz') ? '/quiz' : featureEnabled('join') ? '/join' : undefined
  const secondaryTo = canVisit(hero?.config.secondary_to, featureEnabled)
    ? hero?.config.secondary_to
    : featureEnabled('join') ? '/join' : undefined
  const moduleCount = ['quiz', 'screen', 'join'].filter((key) => (
    featureEnabled(key as SiteFeature['key'])
  )).length

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

  return (
    <>
      <CustomCursor />
      <PageMeta
        title={site.brand.title || `${site.brand.name} · 数字深空`}
        description={site.brand.description}
      />
      <div className="site-home cosmic-home">
        {sections.map((section) => {
          if (section.kind === 'hero') {
            return (
              <Hero
                key={section.id}
                section={section}
                primaryTo={primaryTo}
                secondaryTo={secondaryTo}
                backgrounds={backgrounds}
                moduleCount={moduleCount}
                questionCount={questionCount}
                uptimeSeconds={uptimeSeconds}
                uptimeStartedAt={uptimeStartedAt}
              />
            )
          }
          if (section.kind === 'about') {
            return <Whoami key={section.id} section={section} activities={activities} />
          }
          if ((section.kind === 'quiz' || section.kind === 'join') && section.id === moduleAnchor) {
            return <Modules key={section.id} quiz={quiz} join={join} featureEnabled={featureEnabled} />
          }
          if (section.kind === 'lottery') {
            return <LotterySignal key={section.id} section={section} enabled={featureEnabled('lottery')} />
          }
          if (section.kind === 'gallery') {
            return <Gallery key={section.id} section={section} />
          }
          return null
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
