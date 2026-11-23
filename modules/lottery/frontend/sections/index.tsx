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
      title={sectionConfigText(config, 'title') || '招新抽奖'}
      description={sectionConfigText(config, 'body') || '完成一轮答题即可参与，结果由服务端公平生成。'}
      to={sectionConfigText(config, 'action_to') || '/lottery'}
      openLabel={sectionConfigText(config, 'action_label') || '查看活动'}
    />
  )
}

export const LOTTERY_SECTION_PLUGIN = defineSectionPlugin({
  key: 'lottery',
  version: 1,
  layout: 'module-card',
  Renderer: LotteryModule,
})
