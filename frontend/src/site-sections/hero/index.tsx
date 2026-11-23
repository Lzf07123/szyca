import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Arrow } from '@core/components/ModuleCard'
import ScrambleText from '@core/components/ScrambleText'
import { featureForPath } from '@core/modules/registry'
import {
  defineSectionPlugin,
  sectionAnchor,
  sectionConfigText,
  type SectionRendererProps,
} from '../contract'

function canVisit(path: string | undefined, enabled: (key: string) => boolean): path is string {
  if (!path?.startsWith('/')) return false
  const pathname = path.split(/[?#]/, 1)[0]
  const feature = featureForPath(pathname)
  return !feature || enabled(feature)
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

function HeroSection({ section, context }: SectionRendererProps) {
  const config = section.config
  const title = sectionConfigText(config, 'title') || '把好奇心，写进每一行代码'
  const lines = splitTitle(title)
  const titleID = sectionAnchor('hero-title', section, context)
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

export const HERO_SECTION_PLUGIN = defineSectionPlugin({
  key: 'hero',
  version: 1,
  layout: 'block',
  Renderer: HeroSection,
})
