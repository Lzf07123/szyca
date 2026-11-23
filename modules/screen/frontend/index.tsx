import { lazy } from 'react'
import { defineAppModule, type AppModuleRuntime } from '@core/modules/contract'
import { MODULE_CATALOG } from '@core/generated/catalog.generated'
import { SCREEN_SECTION_PLUGIN } from './sections'

const Screen = lazy(() => import('./pages/Screen'))
const manifest = MODULE_CATALOG.find((module) => module.key === 'screen')!

export const screenModule = defineAppModule({
  key: manifest.key,
  label: manifest.label,
  feature: manifest.feature,
  publicMetric: manifest.public_metric,
  routes: [
    {
      path: '/screen',
      feature: 'screen',
      fullscreen: true,
      Component: Screen,
    },
  ],
})

export const moduleRuntime = {
  manifest: screenModule,
  sections: [SCREEN_SECTION_PLUGIN],
} satisfies AppModuleRuntime
