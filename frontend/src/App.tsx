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
import { useSite, type SiteFeature } from './api/site'
import { useScrollReveal } from './hooks/useScrollReveal'

const Home = lazy(() => import('./pages/Home'))
const Join = lazy(() => import('./pages/Join'))
const Quiz = lazy(() => import('./pages/Quiz'))
const Result = lazy(() => import('./pages/Result'))
const Screen = lazy(() => import('./pages/Screen'))
const Admin = lazy(() => import('./pages/Admin'))
const Lottery = lazy(() => import('./pages/Lottery'))

function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      正在载入
    </div>
  )
}

function FeatureUnavailable({ feature }: { feature: SiteFeature['key'] }) {
  const labels: Record<SiteFeature['key'], string> = {
    quiz: '答题',
    lottery: '抽奖',
    join: '加入我们',
    screen: '排行榜',
  }
  usePageMeta(`${labels[feature]}暂未开放 · 计算机协会`, `${labels[feature]}模块当前未向访客开放。`)
  return (
    <section className="state-page">
      <p className="eyebrow">暂未开放</p>
      <h1>{labels[feature]}模块尚未启用</h1>
      <p>该功能当前未向访客开放，返回首页查看正在进行的活动。</p>
      <Link className="btn btn-primary" to="/">返回首页</Link>
    </section>
  )
}

function FeatureGate({
  feature,
  children,
}: {
  feature: SiteFeature['key']
  children: ReactNode
}) {
  const { featureEnabled } = useSite()
  return featureEnabled(feature) ? <>{children}</> : <FeatureUnavailable feature={feature} />
}

function Layout() {
  const { pathname } = useLocation()
  const { site, error } = useSite()
  const [menuOpen, setMenuOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const navToggleRef = useRef<HTMLButtonElement>(null)
  const fullscreen = pathname === '/screen'
  const isHome = pathname === '/'
  useScrollReveal(pathname)

  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
    const timer = window.setTimeout(() => mainRef.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(timer)
  }, [pathname])

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
        <header className="topbar public-topbar">
          <Link className={`logo${site.brand.logo_url ? ' has-img' : ''}`} to="/" aria-label={`${site.brand.name}首页`}>
            <BrandMark variant="header" />
            <span className="logo-copy">
              <b>{site.brand.name}</b>
              <small>COMPUTER ASSOCIATION</small>
            </span>
          </Link>
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
        </header>
      )}
      {error && !fullscreen && (
        <div className="site-degraded" role="status">
          站点配置暂时不可用，正在显示静态内容。
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

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      {
        path: 'join',
        element: <FeatureGate feature="join"><Join /></FeatureGate>,
      },
      {
        path: 'quiz',
        element: <FeatureGate feature="quiz"><Quiz /></FeatureGate>,
      },
      { path: 'result', element: <Result /> },
      {
        path: 'screen',
        element: <FeatureGate feature="screen"><Screen /></FeatureGate>,
      },
      {
        path: 'lottery',
        element: <FeatureGate feature="lottery"><Lottery /></FeatureGate>,
      },
      { path: 'admin', element: <Admin /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
