import { defineAppModule, type AppModuleRuntime } from '@core/modules/contract'
import { MODULE_CATALOG } from '@core/generated/catalog.generated'
import { GALLERY_SECTION_PLUGIN } from './sections'

const manifest = MODULE_CATALOG.find((module) => module.key === 'gallery')!

export const galleryModule = defineAppModule({
  key: manifest.key,
  label: manifest.label,
  internal: true,
  routes: [],
})

export const moduleRuntime = {
  manifest: galleryModule,
  sections: [GALLERY_SECTION_PLUGIN],
} satisfies AppModuleRuntime
