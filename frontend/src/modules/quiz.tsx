import { lazy } from 'react'
import { defineAppModule } from './contract'

const Quiz = lazy(() => import('../pages/Quiz'))
const Result = lazy(() => import('../pages/Result'))

export const quizModule = defineAppModule({
  key: 'quiz',
  label: '答题',
  feature: 'quiz',
  publicMetric: true,
  routes: [
    {
      path: '/quiz',
      feature: 'quiz',
      Component: Quiz,
    },
    {
      path: '/result',
      Component: Result,
    },
  ],
})
