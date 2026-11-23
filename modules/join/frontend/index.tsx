import { lazy } from 'react'
import {
  defineAppModule,
  type AdminPanelProps,
  type AppModuleRuntime,
} from '@core/modules/contract'
import { MODULE_CATALOG } from '@core/generated/catalog.generated'
import { JOIN_SECTION_PLUGIN } from './sections'
import JoinAdmin from './admin/JoinAdmin'

const Join = lazy(() => import('./pages/Join'))
const manifest = MODULE_CATALOG.find((module) => module.key === 'join')!

export const joinModule = defineAppModule({
  key: manifest.key,
  label: manifest.label,
  feature: manifest.feature,
  publicMetric: manifest.public_metric,
  routes: [
    { path: '/join', feature: 'join', Component: Join },
  ],
})

export const moduleRuntime = {
  manifest: joinModule,
  sections: [JOIN_SECTION_PLUGIN],
  adminPanels: [
    {
      key: 'join-qrcodes',
      tab: 'control',
      permission: 'site.write',
      order: 30,
      Component: ({ context }: AdminPanelProps) => (
        <JoinAdmin canWrite={context.can('site.write')} onMessage={context.notify} />
      ),
    },
  ],
} satisfies AppModuleRuntime
