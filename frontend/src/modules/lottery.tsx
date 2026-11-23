import { lazy } from 'react'
import { defineAppModule } from './contract'

const Lottery = lazy(() => import('../pages/Lottery'))

export const lotteryModule = defineAppModule({
  key: 'lottery',
  label: '抽奖',
  feature: 'lottery',
  routes: [
    {
      path: '/lottery',
      feature: 'lottery',
      Component: Lottery,
    },
  ],
})
