import ModuleCard from '@core/components/ModuleCard'
import {
  defineSectionPlugin,
  sectionConfigText,
  type SectionRendererProps,
} from '@core/site-sections/contract'

function QuizModule({ section, context }: SectionRendererProps) {
  if (!context.featureEnabled('quiz')) return null
  const config = section.config
  return (
    <ModuleCard
      kind="quiz"
      number={context.ordinal}
      title={sectionConfigText(config, 'title').replace('招新', '') || '答题中心'}
      description={sectionConfigText(config, 'body') || '选择难度，完成一轮答题，实时查看成绩与排名。'}
      to={sectionConfigText(config, 'action_to') || '/quiz'}
      openLabel={sectionConfigText(config, 'action_label') || '开始答题'}
    />
  )
}

export const QUIZ_SECTION_PLUGIN = defineSectionPlugin({
  key: 'quiz',
  version: 1,
  layout: 'module-card',
  Renderer: QuizModule,
})
