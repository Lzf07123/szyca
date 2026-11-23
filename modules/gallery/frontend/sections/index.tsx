import {
  defineSectionPlugin,
  sectionAnchor,
  sectionConfigItems,
  sectionConfigText,
  type SectionRendererProps,
} from '@core/site-sections/contract'
import GalleryEditor from './Editor'

function GallerySection({ section, context }: SectionRendererProps) {
  const config = section.config
  const galleryImages = section.gallery ?? []
  const fallbackImages = sectionConfigItems(config)
  const images = (galleryImages.length > 0 ? galleryImages : fallbackImages)
    .filter((item) => item.image_url)
  const anchor = sectionAnchor('gallery', section, context)
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

export const GALLERY_SECTION_PLUGIN = defineSectionPlugin({
  key: 'gallery',
  version: 2,
  layout: 'block',
  Renderer: GallerySection,
  Editor: GalleryEditor,
})
