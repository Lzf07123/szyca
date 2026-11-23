import type { AppModuleManifest, AppModuleRoute } from './contract'
import { MODULE_RUNTIMES } from './registry.generated'

export const APP_MODULES: readonly AppModuleManifest[] = MODULE_RUNTIMES.map((runtime) => runtime.manifest)

function validateRegistry(modules: readonly AppModuleManifest[]) {
  const moduleKeys = new Set<string>()
  const routePaths = new Set<string>()
  for (const module of modules) {
    if (moduleKeys.has(module.key)) {
      throw new Error(`Duplicate app module key: ${module.key}`)
    }
    moduleKeys.add(module.key)
    if (module.routes.length === 0 && !module.internal) {
      throw new Error(`App module ${module.key} has no routes`)
    }
    for (const route of module.routes) {
      if (!route.path.startsWith('/')) {
        throw new Error(`App module route must start with "/": ${route.path}`)
      }
      if (routePaths.has(route.path)) {
        throw new Error(`Duplicate app module route: ${route.path}`)
      }
      routePaths.add(route.path)
      if (route.feature && !module.feature) {
        throw new Error(`App module ${module.key} has a gated route without a module feature`)
      }
      if (route.feature && route.feature !== module.feature) {
        throw new Error(`App module route ${route.path} must use the module feature`)
      }
    }
  }
}

validateRegistry(APP_MODULES)

export interface RegisteredModuleRoute {
  module: AppModuleManifest
  route: AppModuleRoute
}

export const APP_MODULE_ROUTES: readonly RegisteredModuleRoute[] = APP_MODULES.flatMap((module) => (
  module.routes.map((route) => ({ module, route }))
))

function routeMatches(pathname: string, routePath: string) {
  return pathname === routePath || pathname.startsWith(`${routePath}/`)
}

export function findModuleRoute(pathname: string): RegisteredModuleRoute | undefined {
  return [...APP_MODULE_ROUTES]
    .filter(({ route }) => routeMatches(pathname, route.path))
    .sort((a, b) => b.route.path.length - a.route.path.length)[0]
}

export function featureForPath(pathname: string): string | undefined {
  return findModuleRoute(pathname)?.route.feature
}

export function moduleForFeature(feature: string): AppModuleManifest | undefined {
  return APP_MODULES.find((module) => module.feature === feature)
}

export function isFullscreenPath(pathname: string): boolean {
  return findModuleRoute(pathname)?.route.fullscreen === true
}
