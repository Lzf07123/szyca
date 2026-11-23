import {
  defineAppModule,
  type AdminPanelProps,
  type AppModuleRuntime,
} from '@core/modules/contract'
import { MODULE_CATALOG } from '@core/generated/catalog.generated'
import LiveOperations from './admin/LiveOperations'

const manifest = MODULE_CATALOG.find((module) => module.key === 'realtime')!

export const realtimeModule = defineAppModule({
  key: manifest.key,
  label: manifest.label,
  internal: true,
  routes: [],
})

export const moduleRuntime = {
  manifest: realtimeModule,
  sections: [],
  adminPanels: [
    {
      key: 'realtime-operations',
      tab: 'control',
      permission: 'quiz.operate',
      order: 20,
      Component: ({ context }: AdminPanelProps) => (
        <LiveOperations
          onMessage={context.notify}
          onStateChange={context.setQuizState}
        />
      ),
    },
  ],
} satisfies AppModuleRuntime
