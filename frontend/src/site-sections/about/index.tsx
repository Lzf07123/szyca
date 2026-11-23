import {
  defineSectionPlugin,
  sectionAnchor,
  sectionConfigText,
  type SectionRendererProps,
} from '../contract'

function AboutSection({ section, context }: SectionRendererProps) {
  const config = section.config
  const anchor = sectionAnchor('about', section, context)
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

export const ABOUT_SECTION_PLUGIN = defineSectionPlugin({
  key: 'about',
  version: 1,
  layout: 'block',
  Renderer: AboutSection,
})
