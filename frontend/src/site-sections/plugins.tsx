import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import type { HomeSection } from '../api/site'
import ScrambleText from '../components/ScrambleText'
import { featureForPath } from '../modules/registry'
import GalleryEditor from './gallery-editor'
import {
  defineSectionPlugin,
  sectionConfigItems,
  sectionConfigText,
  type SectionRenderContext,
  type SectionRendererProps,
} from './contract'

function canVisit(path: string | undefined, enabled: (key: string) => boolean): path is string {
  if (!path?.startsWith('/')) return false
  const pathname = path.split(/[?#]/, 1)[0]
  const feature = featureForPath(pathname)
  return !feature || enabled(feature)
}

function scopedSectionID(base: string, section: HomeSection, context: SectionRenderContext) {
  return context.instanceIndex === 0 ? base : `${base}-${section.id}`
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

function HeroSection({ section, context }: SectionRendererProps) {
  const config = section.config
  const title = sectionConfigText(config, 'title') || '把好奇心，写进每一行代码'
  const lines = splitTitle(title)
  const titleID = scopedSectionID('hero-title', section, context)
  const uptimeIsLong = context.uptimeSeconds !== null && context.uptimeSeconds >= 30 * 86400
  const heroRef = useRef<HTMLElement>(null)
  const configuredPrimary = sectionConfigText(config, 'primary_to')
  const configuredSecondary = sectionConfigText(config, 'secondary_to')
  const primaryTo = canVisit(configuredPrimary, context.featureEnabled)
    ? configuredPrimary
    : context.featureEnabled('quiz') ? '/quiz' : context.featureEnabled('join') ? '/join' : undefined
  const secondaryTo = canVisit(configuredSecondary, context.featureEnabled)
    ? configuredSecondary
    : context.featureEnabled('join') ? '/join' : undefined
  useHeroParallax(heroRef)

  return (
    <section ref={heroRef} className="home-hero cosmic-hero" aria-labelledby={titleID}>
      <div className="hero-copy" data-parallax="foreground">
        <div className="hero-kicker" data-reveal>
          <span className="signal-dot" aria-hidden="true" />
          <span>STPT · COMPUTER ASSOCIATION</span>
          <span className="kicker-index">SYS / {String(context.ordinal).padStart(3, '0')}</span>
        </div>
        <p className="boot-command" data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
          <span aria-hidden="true">&gt;</span> boot nebula_os ... <b>[OK]</b><i className="terminal-cursor" aria-hidden="true">▊</i>
        </p>
        <h1
          id={titleID}
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
          {sectionConfigText(config, 'subtitle') || '招新答题、技术活动与同好社区，都在这里相遇。'}
        </p>
        <div className="hero-actions" data-reveal style={{ '--reveal-delay': '300ms' } as CSSProperties}>
          {primaryTo && sectionConfigText(config, 'primary_label') && (
            <Link className="btn btn-primary" to={primaryTo}>
              {sectionConfigText(config, 'primary_label')}
              <Arrow />
            </Link>
          )}
          {secondaryTo && sectionConfigText(config, 'secondary_label') && (
            <Link className="btn btn-secondary" to={secondaryTo}>
              {sectionConfigText(config, 'secondary_label')}
            </Link>
          )}
        </div>
        <dl className="hero-facts" data-reveal style={{ '--reveal-delay': '380ms' } as CSSProperties}>
          <div><dt>{String(context.moduleCount).padStart(2, '0')}</dt><dd>启用模块 / MODULES</dd></div>
          <div><dt>{context.questionCount === null ? '--' : context.questionCount.toLocaleString('zh-CN')}</dt><dd>开放题目 / QUESTIONS</dd></div>
          <div className={uptimeIsLong ? 'uptime-fact is-long' : 'uptime-fact'}>
            <dt>{formatUptime(context.uptimeSeconds, context.uptimeStartedAt)}</dt>
            <dd>系统在线 / UPTIME</dd>
          </div>
        </dl>
      </div>

      <div className="hero-visual" data-reveal style={{ '--reveal-delay': '180ms' } as CSSProperties} role="group" aria-label="NEBULA OS 启动终端">
        {context.backgrounds[0] && (
          <img
            className="hero-photo"
            data-parallax="background"
            src={context.backgrounds[0]}
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

function AboutSection({ section, context }: SectionRendererProps) {
  const config = section.config
  const anchor = scopedSectionID('about', section, context)
  return (
    <section className="whoami-section" id={anchor} data-reveal>
      <div className="command-line">
        <span className="command-prompt">$</span> whoami
        <span className="command-arrow" aria-hidden="true">→</span>
        <b>{sectionConfigText(config, 'eyebrow') || '关于我们'}</b>
      </div>
      <div className="whoami-grid">
        <div>
          <p className="section-label">WHO ARE WE / {String(context.ordinal).padStart(2, '0')}</p>
          <h2>{sectionConfigText(config, 'title') || '一起学习，一起创造'}</h2>
        </div>
        <div className="whoami-copy">
          <p>{sectionConfigText(config, 'body') || '计算机协会面向所有对技术感兴趣的同学。我们用真实项目练习协作、工程与表达。'}</p>
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

function ActivitiesSection({ section, context }: SectionRendererProps) {
  const config = section.config
  const items = sectionConfigItems(config)
  const anchor = scopedSectionID('activities', section, context)
  return (
    <section className="home-section activities-plugin-section" id={anchor} aria-labelledby={`${anchor}-title`} data-reveal>
      <div className="section-heading">
        <div>
          <p className="section-label">{sectionConfigText(config, 'eyebrow') || 'ACTIVITIES / 正在发生'}</p>
          <h2 id={`${anchor}-title`}>{sectionConfigText(config, 'title') || '不只是招新'}</h2>
        </div>
        <p>{sectionConfigText(config, 'body') || '技术分享、项目协作与竞赛实践，让学习发生在真实项目中。'}</p>
      </div>
      {items.length > 0 ? (
        <div className="activities-plugin-grid">
          {items.map((item, index) => (
            <article className="activity-card" key={`${item.title ?? 'activity'}-${index}`}>
              <span>[{String(index + 1).padStart(2, '0')}]</span>
              <h3>{item.title || '未命名活动'}</h3>
              <p>{item.body || '活动说明待补充。'}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="gallery-empty">
          <span>[ ACTIVITIES / PENDING ]</span>
          <p>活动内容正在整理。</p>
        </div>
      )}
    </section>
  )
}

function ModuleCard({
  kind,
  number,
  title,
  description,
  to,
  openLabel = 'OPEN MODULE',
}: {
  kind: ModuleKind
  number: number
  title: string
  description: string
  to: string
  openLabel?: string
}) {
  const english = kind.toUpperCase()
  return (
    <article
      className={`module-card module-${kind}`}
      data-reveal
      style={{ '--reveal-delay': `${(number - 1) * 90}ms` } as CSSProperties}
    >
      <Link to={to} aria-label={`进入${title}模块`}>
        <div className="module-topline">
          <span className="module-number">[{String(number).padStart(2, '0')}]</span>
          <span className="module-index">NEBULA / {english}</span>
        </div>
        <div className="module-icon"><ModuleIcon kind={kind} /></div>
        <div className="module-copy">
          <p>{english} / MODULE</p>
          <h3>{title} <span>{english}</span></h3>
          <p className="module-description">{description}</p>
        </div>
        <span className="module-open">{openLabel} <Arrow /></span>
      </Link>
    </article>
  )
}

function QuizModule({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('quiz')) return null
  const config = section.config
  return (
    <ModuleCard
      kind="quiz"
      number={context.ordinal}
      title={sectionConfigText(config, 'title').replace('招新', '') || '答题中心'}
      description={sectionConfigText(config, 'body') || '选择难度，完成一轮答题，实时查看成绩与排名。'}
      to={sectionConfigText(config, 'action_to') || '/quiz'}
      openLabel={sectionConfigText(config, 'action_label') || '开始答题'}
    />
  )
}

function JoinModule({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('join')) return null
  const config = section.config
  return (
    <ModuleCard
      kind="join"
      number={context.ordinal}
      title={sectionConfigText(config, 'title') || '加入我们'}
      description={sectionConfigText(config, 'body') || '扫码加入招新群，不错过下一场活动与协作。'}
      to={sectionConfigText(config, 'action_to') || '/join'}
      openLabel={sectionConfigText(config, 'action_label') || '查看加入方式'}
    />
  )
}

export function RankModuleCard({
  number,
  featureEnabled,
}: {
  number: number
  featureEnabled: (key: string) => boolean
}) {
  if (!featureEnabled('screen')) return null
  return (
    <ModuleCard
      kind="rank"
      number={number}
      title="实时排行"
      description="成绩与名次实时更新，在共同时区里看见每一次进步。"
      to="/screen"
    />
  )
}

function LotterySection({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('lottery')) return null
  const config = section.config
  const anchor = scopedSectionID('lottery', section, context)
  return (
    <aside className="lottery-signal" id={anchor} data-reveal>
      <div className="lottery-signal-meta">
        <span>[EVENT / {String(context.ordinal).padStart(2, '0')}]</span>
        <span>SIGNAL DETECTED</span>
      </div>
      <div>
        <p className="section-label">LIVE EVENT / 现场福利</p>
        <h2>{sectionConfigText(config, 'title') || '招新抽奖'}</h2>
        <p>{sectionConfigText(config, 'body') || '完成一轮答题即可参与，结果由服务端公平生成。'}</p>
      </div>
      <Link className="btn btn-secondary" to={sectionConfigText(config, 'action_to') || '/lottery'}>
        {sectionConfigText(config, 'action_label') || '查看活动'}
        <Arrow />
      </Link>
    </aside>
  )
}

function GallerySection({ section, context }: SectionRendererProps) {
  const config = section.config
  const galleryImages = section.gallery ?? []
  const fallbackImages = sectionConfigItems(config)
  const images = (galleryImages.length > 0 ? galleryImages : fallbackImages)
    .filter((item) => item.image_url)
  const anchor = scopedSectionID('gallery', section, context)
  return (
    <section className="home-section gallery-section" aria-labelledby={`${anchor}-title`} data-reveal>
      <div className="section-heading">
        <div>
          <p className="section-label">{sectionConfigText(config, 'eyebrow') || 'FIELD NOTES / 活动影像'}</p>
          <h2 id={`${anchor}-title`}>{sectionConfigText(config, 'title') || '协会现场'}</h2>
        </div>
        <p>{sectionConfigText(config, 'body') || sectionConfigText(config, 'subtitle') || '技术分享、比赛与协作时刻。'}</p>
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

export const HERO_SECTION_PLUGIN = defineSectionPlugin({
  key: 'hero',
  version: 1,
  layout: 'block',
  Renderer: HeroSection,
})

export const ABOUT_SECTION_PLUGIN = defineSectionPlugin({
  key: 'about',
  version: 1,
  layout: 'block',
  Renderer: AboutSection,
})

export const ACTIVITIES_SECTION_PLUGIN = defineSectionPlugin({
  key: 'activities',
  version: 1,
  layout: 'block',
  Renderer: ActivitiesSection,
})

export const QUIZ_SECTION_PLUGIN = defineSectionPlugin({
  key: 'quiz',
  version: 1,
  layout: 'module-card',
  Renderer: QuizModule,
})

export const LOTTERY_SECTION_PLUGIN = defineSectionPlugin({
  key: 'lottery',
  version: 1,
  layout: 'block',
  Renderer: LotterySection,
})

export const JOIN_SECTION_PLUGIN = defineSectionPlugin({
  key: 'join',
  version: 1,
  layout: 'module-card',
  Renderer: JoinModule,
})

export const GALLERY_SECTION_PLUGIN = defineSectionPlugin({
  key: 'gallery',
  version: 2,
  layout: 'block',
  Renderer: GallerySection,
  Editor: GalleryEditor,
})
