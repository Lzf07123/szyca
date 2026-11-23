import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createBrowserRouter,
  Link,
  NavLink,
  Outlet,
  useLocation,
  useRouteError,
} from 'react-router-dom'
import BrandMark from './components/BrandMark'
import Footer from './components/Footer'
import CosmicBackdrop from './components/CosmicBackdrop'
import { usePageMeta } from './components/PageMeta'
import { useSite } from './api/site'
import { useScrollReveal } from './hooks/useScrollReveal'
import type { AppModuleManifest } from './modules/contract'
import {
  APP_MODULE_ROUTES,
  isFullscreenPath,
  type RegisteredModuleRoute,
} from './modules/registry'

const Home = lazy(() => import('./pages/Home'))
const Admin = lazy(() => import('./pages/Admin'))

function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      正在载入
    </div>
  )
}

function FeatureUnavailable({ module }: { module: AppModuleManifest }) {
  usePageMeta(
    `${module.label}暂未开放 · 计算机协会`,
    `${module.label}模块当前未向访客开放。`,
  )
  return (
    <section className="state-page">
      <p className="eyebrow">暂未开放</p>
      <h1>{module.label}模块尚未启用</h1>
      <p>该功能当前未向访客开放，返回首页查看正在进行的活动。</p>
      <Link className="btn btn-primary" to="/">返回首页</Link>
    </section>
  )
}

function FeatureGate({
  module,
  children,
}: {
  module: AppModuleManifest
  children: ReactNode
}) {
  const { featureEnabled } = useSite()
  if (!module.feature || featureEnabled(module.feature)) return <>{children}</>
  return <FeatureUnavailable module={module} />
}

function Layout() {
  const { pathname } = useLocation()
  const { site, error, loading, reload } = useSite()
  const [menuOpen, setMenuOpen] = useState(false)
  const [headerScrolled, setHeaderScrolled] = useState(() => window.scrollY > 8)
  const mainRef = useRef<HTMLElement>(null)
  const navToggleRef = useRef<HTMLButtonElement>(null)
  const fullscreen = isFullscreenPath(pathname)
  const isHome = pathname === '/'
  const isAdmin = pathname === '/admin'
  useScrollReveal(pathname)

  useEffect(() => {
    setMenuOpen(false)
    setHeaderScrolled(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
    const timer = window.setTimeout(() => mainRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(timer)
  }, [pathname])

  useEffect(() => {
    let frame = 0
    const sync = () => {
      frame = 0
      setHeaderScrolled(window.scrollY > 8)
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(sync)
    }
    sync()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      navToggleRef.current?.focus()
    }
    const closeOnOutsidePress = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('.public-topbar')) return
      setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePress)
    }
  }, [menuOpen])

  return (
    <div className={`app site-shell${fullscreen ? ' fullscreen' : ''}${isHome ? ' route-home' : ''}`}>
      <CosmicBackdrop />
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {!fullscreen && (
        <header className={`topbar public-topbar${headerScrolled ? ' is-scrolled' : ''}${isAdmin ? ' admin-route' : ''}`}>
          <Link className={`logo${site.brand.logo_url ? ' has-img' : ''}`} to="/" aria-label={`${site.brand.name}首页`}>
            <BrandMark variant="header" />
            <span className="logo-copy">
              <b>{site.brand.name}</b>
              <small>COMPUTER ASSOCIATION</small>
            </span>
          </Link>
          {!isAdmin && (
            <>
              <button
                ref={navToggleRef}
                className="nav-toggle"
                type="button"
                aria-expanded={menuOpen}
                aria-controls="site-navigation"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span className="sr-only">{menuOpen ? '关闭导航' : '打开导航'}</span>
              </button>
              <nav id="site-navigation" className={`public-nav${menuOpen ? ' open' : ''}`} aria-label="主导航">
                {site.nav.map((item, index) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => (isActive ? 'active' : undefined)}
                  >
                    <span className="nav-prefix" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </>
          )}
        </header>
      )}
      {error && !fullscreen && (
        <div className="site-degraded" role="status">
          <span>站点配置暂时不可用，正在显示静态内容。</span>
          <button type="button" disabled={loading} onClick={() => void reload()}>
            {loading ? '正在重试…' : '重新连接'}
          </button>
        </div>
      )}
      <main id="main-content" ref={mainRef} className="page" tabIndex={-1}>
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      {!fullscreen && <Footer />}
    </div>
  )
}

function NotFound() {
  usePageMeta('页面不存在 · 计算机协会', '请求的页面不存在或尚未发布。')
  return (
    <section className="state-page">
      <p className="eyebrow">404</p>
      <h1>这个页面不存在</h1>
      <p>链接可能已经更新，或者内容还没有发布。</p>
      <Link className="btn btn-primary" to="/">返回首页</Link>
    </section>
  )
}

function RouteError() {
  const error = useRouteError() as { status?: number; message?: string }
  const notFound = error?.status === 404
  usePageMeta(
    notFound ? '页面不存在 · 计算机协会' : '页面加载失败 · 计算机协会',
    notFound ? '请求的页面不存在或尚未发布。' : '页面加载异常，请刷新后重试。',
  )
  return (
    <section className="state-page">
      <p className="eyebrow">{notFound ? '404' : '页面异常'}</p>
      <h1>{notFound ? '这个页面不存在' : '页面没有顺利载入'}</h1>
      <p>{notFound ? '链接可能已经更新，或者内容还没有发布。' : '请刷新页面重试；如果问题持续，请联系现场工作人员。'}</p>
      <Link className="btn btn-primary" to="/">返回首页</Link>
    </section>
  )
}

function ModuleRoute({ module, route }: RegisteredModuleRoute) {
  const Component = route.Component
  const content = <Component />
  return route.feature ? <FeatureGate module={module}>{content}</FeatureGate> : content
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      ...APP_MODULE_ROUTES.map(({ module, route }) => ({
        path: route.path.replace(/^\//, ''),
        element: <ModuleRoute module={module} route={route} />,
      })),
      { path: 'admin', element: <Admin /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
