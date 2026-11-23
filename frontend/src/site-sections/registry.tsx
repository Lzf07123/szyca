import type { SectionFrontendPlugin } from './contract'
import { MODULE_RUNTIMES } from '../modules/registry.generated'
import { ABOUT_SECTION_PLUGIN } from './about'
import { ACTIVITIES_SECTION_PLUGIN } from './activities'
import { HERO_SECTION_PLUGIN } from './hero'

export const SECTION_FRONTEND_PLUGINS: readonly SectionFrontendPlugin[] = [
  HERO_SECTION_PLUGIN,
  ABOUT_SECTION_PLUGIN,
  ACTIVITIES_SECTION_PLUGIN,
  ...MODULE_RUNTIMES.flatMap((runtime) => (
    (runtime.sections ?? []) as readonly SectionFrontendPlugin[]
  )),
]

function indexPlugins(plugins: readonly SectionFrontendPlugin[]) {
  const index = new Map<string, SectionFrontendPlugin>()
  for (const plugin of plugins) {
    const id = `${plugin.key}@${plugin.version}`
    if (index.has(id)) {
      throw new Error(`Duplicate section frontend plugin: ${id}`)
    }
    index.set(id, plugin)
  }
  return index
}

const SECTION_FRONTEND_PLUGIN_MAP = indexPlugins(SECTION_FRONTEND_PLUGINS)

export function getSectionPlugin(
  key: string,
  version: number,
): SectionFrontendPlugin | undefined {
  return SECTION_FRONTEND_PLUGIN_MAP.get(`${key}@${version}`)
}

export function supportsSectionPlugin(key: string, version: number): boolean {
  return SECTION_FRONTEND_PLUGIN_MAP.has(`${key}@${version}`)
}
