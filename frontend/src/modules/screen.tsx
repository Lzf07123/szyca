import { lazy } from 'react'
import { defineAppModule } from './contract'

const Screen = lazy(() => import('../pages/Screen'))

export const screenModule = defineAppModule({
  key: 'screen',
  label: '排行榜',
  feature: 'screen',
  publicMetric: true,
  routes: [
    {
      path: '/screen',
      feature: 'screen',
      fullscreen: true,
      Component: Screen,
    },
  ],
})
