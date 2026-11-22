import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import BrandMark from '../components/BrandMark'
import PageMeta from '../components/PageMeta'
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

function formatUptime(seconds: number | null) {
  if (seconds === null) return '--'
  const totalMinutes = Math.max(0, Math.floor(seconds / 60))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
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
  uptimeSeconds,
}: {
  section: HomeSection
  primaryTo?: string
  secondaryTo?: string
  backgrounds: string[]
  uptimeSeconds: number | null
}) {
  const config = section.config
  const title = config.title || '把好奇心，写进每一行代码'
  const lines = splitTitle(title)

  return (
    <section className="home-hero cosmic-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="hero-kicker" data-reveal>
          <span className="signal-dot" aria-hidden="true" />
          <span>STPT · COMPUTER ASSOCIATION</span>
          <span className="kicker-index">SYS / 001</span>
        </div>
        <p className="boot-command" data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
          <span aria-hidden="true">&gt;</span> boot nebula_os ... <b>[OK]</b><i className="terminal-cursor" aria-hidden="true">▊</i>
        </p>
        <h1 id="hero-title" data-reveal style={{ '--reveal-delay': '140ms' } as CSSProperties}>
          {lines.map((line, index) => (
            <span className="hero-title-line" key={`${line}-${index}`}>{line}</span>
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
          <div><dt>03</dt><dd>核心模块 / MODULES</dd></div>
          <div><dt>150</dt><dd>开放题目 / QUESTIONS</dd></div>
          <div><dt>{formatUptime(uptimeSeconds)}</dt><dd>系统在线 / UPTIME</dd></div>
        </dl>
      </div>

      <div className="hero-visual" data-reveal style={{ '--reveal-delay': '180ms' } as CSSProperties} role="group" aria-label="NEBULA OS 启动终端">
        {backgrounds[0] && <img className="hero-photo" src={backgrounds[0]} alt="" loading="eager" />}
        <div className="hero-grid" aria-hidden="true" />
        <span className="hero-coordinate hero-coordinate-a" aria-hidden="true">NET / 90 NODES</span>
        <span className="hero-coordinate hero-coordinate-b" aria-hidden="true">GRID / 56 PX</span>
        <div className="terminal-card">
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
        <div className="signal-orbit" aria-hidden="true">
          <BrandMark variant="orbit" />
          <small>COMPUTER<br />ASSOCIATION</small>
        </div>
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

export default function Home() {
  const { site, featureEnabled } = useSite()
  const [uptimeSeconds, setUptimeSeconds] = useState<number | null>(null)
  const sections = [...site.sections].filter((section) => section.enabled).sort((a, b) => a.sort - b.sort)
  const hero = sections.find((section) => section.kind === 'hero')
  const about = sections.find((section) => section.kind === 'about')
  const activities = sections.find((section) => section.kind === 'activities')
  const quiz = sections.find((section) => section.kind === 'quiz')
  const lottery = sections.find((section) => section.kind === 'lottery')
  const join = sections.find((section) => section.kind === 'join')
  const backgrounds = site.backgrounds.map((background) => background.path)
  const primaryTo = canVisit(hero?.config.primary_to, featureEnabled)
    ? hero?.config.primary_to
    : featureEnabled('quiz') ? '/quiz' : featureEnabled('join') ? '/join' : undefined
  const secondaryTo = canVisit(hero?.config.secondary_to, featureEnabled)
    ? hero?.config.secondary_to
    : featureEnabled('join') ? '/join' : undefined

  useEffect(() => {
    let alive = true
    const syncUptime = () => {
      void api<{ uptime_seconds: number }>('/api/runtime')
        .then((runtime) => {
          if (alive && Number.isFinite(runtime.uptime_seconds)) {
            setUptimeSeconds(runtime.uptime_seconds)
          }
        })
        .catch(() => undefined)
    }
    syncUptime()
    const timer = window.setInterval(syncUptime, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <>
      <PageMeta
        title={site.brand.title || `${site.brand.name} · 数字深空`}
        description={site.brand.description}
      />
      <div className="site-home cosmic-home">
        {hero && (
          <Hero
            section={hero}
            primaryTo={primaryTo}
            secondaryTo={secondaryTo}
            backgrounds={backgrounds}
            uptimeSeconds={uptimeSeconds}
          />
        )}
        <Whoami section={about} activities={activities} />
        <Modules quiz={quiz} join={join} featureEnabled={featureEnabled} />
        <LotterySignal section={lottery} enabled={featureEnabled('lottery')} />
      </div>
    </>
  )
}
