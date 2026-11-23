import ModuleCard from '@core/components/ModuleCard'
import {
  defineSectionPlugin,
  sectionAnchor,
  sectionConfigText,
  type SectionRendererProps,
} from '@core/site-sections/contract'

function LotteryModule({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('lottery')) return null
  const config = section.config
  return (
    <ModuleCard
      id={sectionAnchor('lottery', section, context)}
      kind="lottery"
      number={context.ordinal}
      title={sectionConfigText(config, 'title') || '号码抽奖'}
      description={sectionConfigText(config, 'body') || '现场号码抽奖将在大屏实时公布中奖结果。'}
      to={sectionConfigText(config, 'action_to') || '/lottery'}
      openLabel={sectionConfigText(config, 'action_label') || '查看大屏'}
    />
  )
}

export const LOTTERY_SECTION_PLUGIN = defineSectionPlugin({
  key: 'lottery',
  version: 1,
  layout: 'module-card',
  Renderer: LotteryModule,
})
