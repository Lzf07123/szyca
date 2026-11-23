import { lazy } from 'react'
import {
  defineAppModule,
  type AppModuleRuntime,
} from '@core/modules/contract'
import { MODULE_CATALOG } from '@core/generated/catalog.generated'
import { LOTTERY_SECTION_PLUGIN } from './sections'
import AdminLottery from './admin/AdminLottery'

const LotteryScreen = lazy(() => import('./pages/LotteryScreen'))
const LotteryParticipate = lazy(() => import('./pages/Lottery'))
const manifest = MODULE_CATALOG.find((module) => module.key === 'lottery')!

export const lotteryModule = defineAppModule({
  key: manifest.key,
  label: manifest.label,
  feature: manifest.feature,
  publicMetric: manifest.public_metric,
  routes: [
    {
      path: '/lottery',
      feature: 'lottery',
      fullscreen: true,
      Component: LotteryScreen,
    },
    {
      path: '/lottery/participate',
      feature: 'lottery',
      Component: LotteryParticipate,
    },
  ],
})

export const moduleRuntime = {
  manifest: lotteryModule,
  sections: [LOTTERY_SECTION_PLUGIN],
  adminPanels: [
    {
      key: 'lottery-admin',
      tab: 'lottery',
      permission: 'lottery.configure',
      order: 10,
      Component: AdminLottery,
    },
  ],
} satisfies AppModuleRuntime
