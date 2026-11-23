import ModuleCard from '@core/components/ModuleCard'
import {
  defineSectionPlugin,
  sectionConfigText,
  type SectionRendererProps,
} from '@core/site-sections/contract'

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

export const JOIN_SECTION_PLUGIN = defineSectionPlugin({
  key: 'join',
  version: 1,
  layout: 'module-card',
  Renderer: JoinModule,
})
