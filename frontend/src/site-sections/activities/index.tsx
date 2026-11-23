import {
  defineSectionPlugin,
  sectionAnchor,
  sectionConfigItems,
  sectionConfigText,
  type SectionRendererProps,
} from '../contract'

function ActivitiesSection({ section, context }: SectionRendererProps) {
  const config = section.config
  const items = sectionConfigItems(config)
  const anchor = sectionAnchor('activities', section, context)
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

export const ACTIVITIES_SECTION_PLUGIN = defineSectionPlugin({
  key: 'activities',
  version: 1,
  layout: 'block',
  Renderer: ActivitiesSection,
})
