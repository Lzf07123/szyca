import { Link } from 'react-router-dom'
import TechParticles from '../components/TechParticles'
import PageMeta from '../components/PageMeta'
import {
  useSite,
  type HomeSection,
  type SectionConfig,
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

function Eyebrow({ children }: { children?: string }) {
  return children ? <p className="section-eyebrow">{children}</p> : null
}

function HeroTitle({ title }: { title?: string }) {
  const parts = title?.match(/[^，。！？]+[，。！？]?/g) ?? [title || '']
  return (
    <>
      {parts.map((part, index) => (
        <span className="hero-title-line" key={`${part}-${index}`}>{part}</span>
      ))}
    </>
  )
}

function Hero({
  section,
  backgrounds,
  featureEnabled,
}: {
  section: HomeSection
  backgrounds: string[]
  featureEnabled: (key: SiteFeature['key']) => boolean
}) {
  const config = section.config
  const primaryTo = canVisit(config.primary_to, featureEnabled) ? config.primary_to : undefined
  const secondaryTo = canVisit(config.secondary_to, featureEnabled) ? config.secondary_to : undefined
  return (
    <section className="home-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <Eyebrow>{config.eyebrow}</Eyebrow>
        <h1 id="hero-title"><HeroTitle title={config.title} /></h1>
        <p className="hero-subtitle">{config.subtitle}</p>
        <div className="hero-actions">
          {primaryTo && config.primary_label && (
            <Link className="btn btn-primary" to={primaryTo}>{config.primary_label}</Link>
          )}
          {secondaryTo && config.secondary_label && (
            <Link className="btn btn-secondary" to={secondaryTo}>{config.secondary_label}</Link>
          )}
        </div>
        <dl className="hero-facts">
          <div><dt>学习</dt><dd>真实项目</dd></div>
          <div><dt>协作</dt><dd>开放社区</dd></div>
          <div><dt>创造</dt><dd>从想法到上线</dd></div>
        </dl>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="hero-grid" />
        <div className="hero-particles">
          <TechParticles />
        </div>
        <div className="terminal-card">
          <div className="terminal-bar"><i /><i /><i /></div>
          <p><span>const</span> curiosity = <b>true</b>;</p>
          <p><span>while</span> (learning) {'{'}</p>
          <p className="indent">build(<em>something</em>);</p>
          <p>{'}'}</p>
          <div className="terminal-signal">SIGNAL / 2026</div>
        </div>
        <div className="orbit-card">
          <span>STPT</span>
          <b>CA</b>
        </div>
        {backgrounds[0] && (
          <img className="hero-photo" src={backgrounds[0]} alt="" loading="eager" />
        )}
      </div>
    </section>
  )
}

function About({ section }: { section: HomeSection }) {
  const config = section.config
  return (
    <section className="home-section about-section" id="about">
      <div className="section-number" aria-hidden="true">01</div>
      <div>
        <Eyebrow>{config.eyebrow}</Eyebrow>
        <h2>{config.title}</h2>
      </div>
      <div className="about-copy">
        <p>{config.body}</p>
        <Link className="text-link" to="/join">认识更多同好<span aria-hidden="true">↗</span></Link>
      </div>
    </section>
  )
}

function Activities({ section }: { section: HomeSection }) {
  const config = section.config
  return (
    <section className="home-section activities-section" id="activities">
      <div className="section-heading">
        <div>
          <Eyebrow>{config.eyebrow}</Eyebrow>
          <h2>{config.title}</h2>
        </div>
        <p>从第一次提交代码，到一起完成一个能被使用的作品。</p>
      </div>
      <div className="activity-grid">
        {(config.items ?? []).map((item, index) => (
          <article className="activity-card" key={`${item.title}-${index}`}>
            <span className="activity-no">{String(index + 1).padStart(2, '0')}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function ActionSection({
  section,
  feature,
  featureEnabled,
}: {
  section: HomeSection
  feature: SiteFeature['key']
  featureEnabled: (key: SiteFeature['key']) => boolean
}) {
  if (!featureEnabled(feature)) return null
  const config: SectionConfig = section.config
  const href = canVisit(config.action_to, featureEnabled) ? config.action_to : undefined
  return (
    <section className={`home-section action-section action-${section.kind}`} id={section.kind}>
      <div>
        <Eyebrow>{config.eyebrow}</Eyebrow>
        <h2>{config.title}</h2>
        <p>{config.body}</p>
      </div>
      {href && config.action_label && (
        <Link className="btn btn-primary" to={href}>{config.action_label}</Link>
      )}
    </section>
  )
}

function Gallery({ section, backgrounds }: { section: HomeSection; backgrounds: string[] }) {
  const config = section.config
  return (
    <section className="home-section gallery-section" id="gallery">
      <div className="section-heading">
        <div>
          <Eyebrow>{config.eyebrow}</Eyebrow>
          <h2>{config.title}</h2>
        </div>
        <p>{config.body}</p>
      </div>
      {backgrounds.length > 0 ? (
        <div className="gallery-grid">
          {backgrounds.slice(0, 8).map((url, index) => (
            <figure key={url} className={`gallery-item gallery-item-${(index % 4) + 1}`}>
              <img src={url} alt={`协会活动影像 ${index + 1}`} loading="lazy" />
            </figure>
          ))}
        </div>
      ) : (
        <div className="gallery-empty">
          <span aria-hidden="true">CA / ARCHIVE</span>
          <p>活动照片正在整理，下一次现场见。</p>
        </div>
      )}
    </section>
  )
}

export default function Home() {
  const { site, featureEnabled } = useSite()
  const backgrounds = site.backgrounds.map((background) => background.path)
  const sections = [...site.sections].sort((a, b) => a.sort - b.sort)
  const hero = sections.find((section) => section.kind === 'hero')

  return (
    <>
      <PageMeta
        title={site.brand.title || `${site.brand.name} · 官网`}
        description={site.brand.description}
      />
      <div className="site-home">
        {hero && (
          <Hero section={hero} backgrounds={backgrounds} featureEnabled={featureEnabled} />
        )}
        {sections.filter((section) => section.kind !== 'hero').map((section) => {
          switch (section.kind) {
            case 'about':
              return <About key={section.id} section={section} />
            case 'activities':
              return <Activities key={section.id} section={section} />
            case 'quiz':
            case 'lottery':
            case 'join':
              return (
                <ActionSection
                  key={section.id}
                  section={section}
                  feature={section.kind}
                  featureEnabled={featureEnabled}
                />
              )
            case 'gallery':
              return <Gallery key={section.id} section={section} backgrounds={backgrounds} />
            default:
              return null
          }
        })}
      </div>
    </>
  )
}
