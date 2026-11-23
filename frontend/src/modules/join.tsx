import { lazy } from 'react'
import { defineAppModule } from './contract'

const Join = lazy(() => import('../pages/Join'))

export const joinModule = defineAppModule({
  key: 'join',
  label: '加入我们',
  feature: 'join',
  publicMetric: true,
  routes: [
    {
      path: '/join',
      feature: 'join',
      Component: Join,
    },
  ],
})
