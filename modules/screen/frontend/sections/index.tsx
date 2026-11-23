import ModuleCard from '@core/components/ModuleCard'
import {
  defineSectionPlugin,
  sectionConfigText,
  type SectionRendererProps,
} from '@core/site-sections/contract'

function ScreenModule({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('screen')) return null
  const config = section.config
  return (
    <ModuleCard
      kind="rank"
      number={context.ordinal}
      title={sectionConfigText(config, 'title') || '实时排行'}
      description={sectionConfigText(config, 'body') || '成绩与名次实时更新，在共同时区里看见每一次进步。'}
      to={sectionConfigText(config, 'action_to') || '/screen'}
      openLabel={sectionConfigText(config, 'action_label') || '查看排行榜'}
    />
  )
}

export const SCREEN_SECTION_PLUGIN = defineSectionPlugin({
  key: 'screen',
  version: 1,
  layout: 'module-card',
  Renderer: ScreenModule,
})
