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
      moduleLabel="SCREEN"
      title={sectionConfigText(config, 'title') || '抽奖大屏'}
      description={sectionConfigText(config, 'body') || '现场号码抽奖实时开奖，中奖结果在大屏统一公布。'}
      to={sectionConfigText(config, 'action_to') || '/lottery'}
      openLabel={sectionConfigText(config, 'action_label') || '进入大屏'}
    />
  )
}

function LotteryParticipateModule({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('lottery')) return null
  const config = section.config
  return (
    <ModuleCard
      id={sectionAnchor('lottery-participate', section, context)}
      kind="lottery"
      number={context.ordinal}
      moduleLabel="RECRUIT"
      title={sectionConfigText(config, 'title') || '招新抽奖'}
      description={sectionConfigText(config, 'body') || '完成答题后参与个人抽取，中奖结果与奖品以现场公布为准。'}
      to={sectionConfigText(config, 'action_to') || '/lottery/participate'}
      openLabel={sectionConfigText(config, 'action_label') || '参与抽奖'}
    />
  )
}

export const LOTTERY_SECTION_PLUGIN = defineSectionPlugin({
  key: 'lottery',
  version: 1,
  layout: 'module-card',
  Renderer: LotteryModule,
})

export const LOTTERY_PARTICIPATE_SECTION_PLUGIN = defineSectionPlugin({
  key: 'lottery-participate',
  version: 1,
  layout: 'module-card',
  Renderer: LotteryParticipateModule,
})
