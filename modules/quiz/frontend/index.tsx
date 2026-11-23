import { lazy } from 'react'
import {
  defineAppModule,
  type AdminPanelProps,
  type AppModuleRuntime,
} from '@core/modules/contract'
import { MODULE_CATALOG } from '@core/generated/catalog.generated'
import { QUIZ_SECTION_PLUGIN } from './sections'
import QuizAdmin from './admin/QuizAdmin'

const Quiz = lazy(() => import('./pages/Quiz'))
const Result = lazy(() => import('./pages/Result'))
const manifest = MODULE_CATALOG.find((module) => module.key === 'quiz')!

export const quizModule = defineAppModule({
  key: manifest.key,
  label: manifest.label,
  feature: manifest.feature,
  publicMetric: manifest.public_metric,
  routes: [
    { path: '/quiz', feature: 'quiz', Component: Quiz },
    { path: '/result', Component: Result },
  ],
})

export const moduleRuntime = {
  manifest: quizModule,
  sections: [QUIZ_SECTION_PLUGIN],
  adminPanels: [
    {
      key: 'quiz-questions',
      tab: 'questions',
      permission: 'quiz.read',
      order: 10,
      Component: ({ context }: AdminPanelProps) => (
        <QuizAdmin
          canWrite={context.can('quiz.write')}
          onMessage={context.notify}
        />
      ),
    },
  ],
} satisfies AppModuleRuntime
