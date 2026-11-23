import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { api, clearCSRFToken, csrfHeader, setCSRFToken } from '../api/client'
import { setFavicon, useSite } from '../api/site'
import ConfirmDialog from '../components/ConfirmDialog'
import { usePageMeta } from '../components/PageMeta'
import { MODULE_CATALOG } from '../generated/catalog.generated'
import { MODULE_RUNTIMES } from '../modules/registry.generated'
import type { AdminPanelContribution, AdminRuntimeContext } from '../modules/contract'
import AccessPanel from './admin/AccessPanel'
import AdminOverview, { type OverviewAction } from './admin/AdminOverview'
import AuditPanel from './admin/AuditPanel'
import MediaPanel from './admin/MediaPanel'
import SiteEditor from './admin/SiteEditor'

interface Bg {
  id: number
  file_path: string
  active: boolean
}

interface OvResp {
  overview: {
    users: number
    attempts: number
    participants: number
    online: number
    questions: number
    backgrounds: number
    db: string
    redis: string
  }
  mem_mb: number
  goroutines: number
  uptime: string
}

interface AdminAccount {
  id: number
  username: string
  role: 'owner' | 'content_editor' | 'event_operator' | 'data_viewer'
  capabilities: string[]
  legacy: boolean
}

interface AdminConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  action: () => void | Promise<void>
}

type AdminTab = string

const ADMIN_TABS = [
  { key: 'overview', label: '概览', group: 'operations', permission: 'site.read', order: 10 },
  { key: 'site', label: '站点内容', group: 'content', permission: 'site.read', order: 40 },
  { key: 'appearance', label: '媒体与外观', group: 'content', permission: 'media.read', order: 60 },
  { key: 'access', label: '管理员', group: 'governance', permission: 'access.manage', order: 70 },
  { key: 'audit', label: '审计', group: 'governance', permission: 'audit.read', order: 80 },
  ...MODULE_CATALOG.flatMap((module) => module.admin_tabs),
].sort((a, b) => a.order - b.order)

const ADMIN_GROUPS = [
  { key: 'operations', label: '现场运营' },
  { key: 'content', label: '内容维护' },
  { key: 'governance', label: '系统治理' },
] as const

const roleLabel: Record<AdminAccount['role'], string> = {
  owner: '所有者',
  content_editor: '内容编辑',
  event_operator: '活动运营',
  data_viewer: '数据查看',
}

function isAdminTab(value: string | null): value is AdminTab {
  return ADMIN_TABS.some((item) => item.key === value)
}

export default function Admin() {
  usePageMeta('后台管理 · 计算机协会', '计算机协会官网后台管理。')
  const { reload: reloadSite } = useSite()
  const [searchParams, setSearchParams] = useSearchParams()
  const [username, setUsername] = useState('owner')
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState<AdminAccount | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [ov, setOv] = useState<OvResp | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewUpdatedAt, setOverviewUpdatedAt] = useState<Date | null>(null)
  const [tab, setTab] = useState<AdminTab>(() => {
    const requested = searchParams.get('tab')
    return isAdminTab(requested) ? requested : 'overview'
  })
  const [navOpen, setNavOpen] = useState(false)
  const navToggleRef = useRef<HTMLButtonElement>(null)
  const adminContentRef = useRef<HTMLDivElement>(null)
  const [wipe, setWipe] = useState<{ step: 'ask' | 'final' } | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<AdminConfirmRequest | null>(null)
  const [qState, setQState] = useState<'start' | 'stop'>('stop')
  const [msg, setMsg] = useState('')
  const [dataErrors, setDataErrors] = useState<Record<string, string>>({})
  const [siteDirty, setSiteDirty] = useState(false)
  const [bgs, setBgs] = useState<Bg[]>([])
  const [uploading, setUploading] = useState(false)
  const [footer, setFooter] = useState({ owner: '', license: '', icp: '', icp_icon: '', police: '', police_icon: '' })
  const [logo, setLogo] = useState('')
  const verified = account !== null

  const can = useCallback((permission: string) => {
    if (!account) return false
    return account.capabilities.includes('*') || account.capabilities.includes(permission)
  }, [account])

  const moduleAdminPanels = useMemo<AdminPanelContribution[]>(() => (
    MODULE_RUNTIMES
      .flatMap((runtime) => runtime.adminPanels ?? [])
      .sort((a, b) => a.order - b.order)
  ), [])

  const adminContext = useMemo<AdminRuntimeContext>(() => ({
    can,
    notify: (message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`),
    reloadSite,
    setQuizState: setQState,
  }), [can, reloadSite])

  const applyTab = useCallback((next: AdminTab) => {
    setTab(next)
    setNavOpen(false)
    setMsg((current) => current.startsWith('✔') ? '' : current)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
      adminContentRef.current?.focus({ preventScroll: true })
    })
    setSearchParams((current) => {
      const updated = new URLSearchParams(current)
      if (next === 'overview') updated.delete('tab')
      else updated.set('tab', next)
      return updated
    }, { replace: true })
  }, [setSearchParams])

  const selectTab = useCallback((next: AdminTab) => {
    if (tab === 'site' && next !== 'site' && siteDirty) {
      setConfirmRequest({
        title: '离开站点内容编辑？',
        message: '当前有未保存的站点内容修改，离开后这些修改将丢失。',
        confirmLabel: '放弃修改并离开',
        tone: 'danger',
        action: () => applyTab(next),
      })
      return
    }
    applyTab(next)
  }, [applyTab, siteDirty, tab])

  useEffect(() => {
    if (!msg || !msg.startsWith('✔')) return
    const timer = window.setTimeout(() => setMsg(''), 4500)
    return () => window.clearTimeout(timer)
  }, [msg])

  useEffect(() => {
    if (!navOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setNavOpen(false)
      navToggleRef.current?.focus()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [navOpen])

  const reportLoadFailure = useCallback((scope: string, cause: unknown) => {
    setDataErrors((current) => ({
      ...current,
      [scope]: (cause as Error).message || '请求失败',
    }))
  }, [])

  const clearLoadFailure = useCallback((scope: string) => {
    setDataErrors((current) => {
      if (!(scope in current)) return current
      const next = { ...current }
      delete next[scope]
      return next
    })
  }, [])

  const checkSession = useCallback(async () => {
    try {
      const data = await api<{ account: AdminAccount | null; csrf_token: string }>('/api/admin/auth/status')
      if (data.account) {
        setAccount(data.account)
        setCSRFToken(data.csrf_token)
        setMsg('')
      } else {
        setAccount(null)
        clearCSRFToken()
      }
    } catch {
      setAccount(null)
      clearCSRFToken()
    } finally {
      setAuthChecking(false)
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  useEffect(() => {
    const requested = searchParams.get('tab')
    if (!isAdminTab(requested) || requested === tab) return
    setTab(requested)
    setNavOpen(false)
    setMsg((current) => current.startsWith('✔') ? '' : current)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
      adminContentRef.current?.focus({ preventScroll: true })
    })
  }, [searchParams, tab])

  useEffect(() => {
    if (!wipe) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWipe(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [wipe])

  const submitLogin = async () => {
    if (authBusy) return
    setAuthBusy(true)
    setMsg('')
    try {
      const data = await api<{ account: AdminAccount; csrf_token: string }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setCSRFToken(data.csrf_token)
      setAccount(data.account)
      setPassword('')
    } catch (cause) {
      setMsg(`✘ ${(cause as Error).message}`)
    } finally {
      setAuthBusy(false)
    }
  }

  const performLogout = async () => {
    try {
      await api('/api/admin/auth/logout', { method: 'POST' })
    } catch {
      /* 本地状态仍需退出 */
    }
    clearCSRFToken()
    setAccount(null)
    setOv(null)
    setOverviewError('')
    setOverviewUpdatedAt(null)
    setDataErrors({})
    setPassword('')
  }

  const logout = () => {
    if (siteDirty) {
      setConfirmRequest({
        title: '退出后台登录？',
        message: '站点内容还有未保存修改，退出登录后这些修改将丢失。',
        confirmLabel: '退出登录',
        tone: 'danger',
        action: performLogout,
      })
      return
    }
    void performLogout()
  }

  const loadOverview = useCallback(async () => {
    if (!verified || !can('site.read')) return
    setOverviewLoading(true)
    try {
      const data = await api<OvResp>('/api/admin/overview')
      setOv(data)
      setOverviewError('')
      setOverviewUpdatedAt(new Date())
      clearLoadFailure('overview')
    } catch (cause) {
      setOverviewError((cause as Error).message || '概览读取失败')
      reportLoadFailure('overview', cause)
    } finally {
      setOverviewLoading(false)
    }
  }, [clearLoadFailure, can, reportLoadFailure, verified])

  // 答题状态 5s 轮询（控制面板提示准确）
  useEffect(() => {
    if (!verified || !can('site.read')) return
    const sync = () => {
      void api<{ quiz_state: string }>('/api/config')
        .then((c) => setQState(c.quiz_state === 'start' ? 'start' : 'stop'))
        .catch(() => undefined)
    }
    void sync()
    const t = window.setInterval(sync, 5000)
    return () => clearInterval(t)
  }, [verified, can])

  // 概览 10s 自动刷新；等待上一次请求结束后再排下一次，避免慢请求叠加
  useEffect(() => {
    if (!verified || !can('site.read')) return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      await loadOverview()
      if (!cancelled) timer = window.setTimeout(poll, 10000)
    }
    timer = window.setTimeout(poll, 10000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [verified, can, loadOverview])

  const reloadBgs = useCallback(async () => {
    if (!can('media.read')) return
    try {
      const d = await api<{ backgrounds: Bg[] }>('/api/admin/backgrounds')
      setBgs(d.backgrounds || [])
      clearLoadFailure('backgrounds')
    } catch (cause) {
      reportLoadFailure('backgrounds', cause)
    }
  }, [can, clearLoadFailure, reportLoadFailure])

  const reloadLogo = useCallback(async () => {
    if (!can('site.read')) return
    try {
      const d = await api<{ logo_url: string }>('/api/admin/logo')
      setLogo(d.logo_url || '')
      clearLoadFailure('logo')
    } catch (cause) {
      reportLoadFailure('logo', cause)
    }
  }, [can, clearLoadFailure, reportLoadFailure])

  const reloadFooter = useCallback(async () => {
    if (!can('site.read')) return
    try {
      const d = await api<{ footer: { owner: string; license: string; icp: string; icp_icon: string; police: string; police_icon: string } }>('/api/admin/footer')
      setFooter(d.footer)
      clearLoadFailure('footer')
    } catch (cause) {
      reportLoadFailure('footer', cause)
    }
  }, [can, clearLoadFailure, reportLoadFailure])

  const reloadAll = useCallback(async () => {
    await Promise.all([
      loadOverview(),
      reloadBgs(),
      reloadFooter(),
      reloadLogo(),
    ])
  }, [loadOverview, reloadBgs, reloadFooter, reloadLogo])

  useEffect(() => {
    if (verified) void reloadAll()
  }, [verified, reloadAll])

  // 上传到 /uploads 并返回 URL（二维码换图、备案图标等）
  const uploadImage = async (f: File): Promise<string> => {
    const fd = new FormData()
    fd.append('file', f)
    const res = await fetch('/api/admin/uploads', {
      method: 'POST',
      headers: csrfHeader(),
      body: fd,
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(b.error || `HTTP ${res.status}`)
    }
    const d = await res.json()
    return d.url as string
  }

  const uploadOne = async (f: File): Promise<void> => {
    const fd = new FormData()
    fd.append('file', f)
    const res = await fetch('/api/admin/backgrounds', {
      method: 'POST',
      headers: csrfHeader(),
      body: fd,
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      const msg = b.error === `HTTP ${res.status}` && res.status === 413
        ? '图片超过服务器大小限制，请压缩到 10MB 以内'
        : (b.error || `HTTP ${res.status}`)
      throw new Error(`${f.name}：${msg}`)
    }
  }

  // 批量上传：最多 3 个并发，逐个提交，统计成功/失败
  const onPickBg = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    let ok = 0
    const errors: string[] = []
    const queue = [...files]
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift()
        if (!f) return
        try {
          await uploadOne(f)
          ok++
        } catch (err) {
          errors.push((err as Error).message)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker))
    setUploading(false)
    if (errors.length) {
      setMsg(`✘ 上传完成：成功 ${ok}/${files.length} 张；${errors.join('；')}`)
    } else {
      setMsg(`✔ 批量上传成功：${ok} 张，首页已生效`)
    }
    void reloadBgs()
  }

  const toggleBg = async (background: Bg) => {
    try {
      await api(`/api/admin/backgrounds/${background.id}/active`, {
        method: 'POST',
        body: JSON.stringify({ active: !background.active }),
      })
      setMsg(background.active ? '✔ 背景已停用' : '✔ 背景已启用')
      await reloadBgs()
    } catch (cause) {
      setMsg(`✘ ${(cause as Error).message}`)
    }
  }

  const deleteBackground = async (b: Bg) => {
    try {
      await api(`/api/admin/backgrounds/${b.id}`, { method: 'DELETE' })
      setMsg('✔ 背景已删除')
      void reloadBgs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const requestDeleteBackground = (background: Bg) => {
    const filename = background.file_path.split('/').pop() || background.id
    setConfirmRequest({
      title: `删除背景图「${filename}」？`,
      message: '图片文件将从数据卷移除，此操作不可恢复。',
      confirmLabel: '确认删除',
      tone: 'danger',
      action: () => deleteBackground(background),
    })
  }

  // 站点 Logo：上传即保存；可一键恢复内置样式
  const saveLogo = async (url: string) => {
    try {
      await api('/api/admin/logo', {
        method: 'POST',
        body: JSON.stringify({ logo_url: url }),
      })
      setLogo(url)
      setFavicon(url)
      setMsg(url ? '✔ Logo 已更新，前台刷新后生效（favicon 已同步）' : '✔ 已恢复内置 Logo 样式')
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const saveFooter = async () => {
    try {
      await api('/api/admin/footer', {
        method: 'POST',
        body: JSON.stringify(footer),
      })
      setMsg('✔ 页脚信息已更新')
    } catch (cause) {
      setMsg(`✘ ${(cause as Error).message}`)
    }
  }

  // 下载受口令保护的文件
  const download = async (path: string, fallbackName: string) => {
    try {
      const res = await fetch(path)
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setMsg(`✘ ${b.error || `HTTP ${res.status}`}`)
        return
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = fallbackName
      a.click()
      URL.revokeObjectURL(a.href)
      setMsg('✔ 下载已开始')
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const confirmWipe = async () => {
    if (!wipe) return
    setWipe(null)
    try {
      const d = await api<{ backgrounds_deleted: number }>('/api/admin/backgrounds', {
        method: 'DELETE',
      })
      setMsg(`✔ 已清空 ${d.backgrounds_deleted} 张背景图`)
      void reloadBgs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }
  const allowedTabs = ADMIN_TABS.filter((item) => can(item.permission))
  const visibleTab = allowedTabs.some((item) => item.key === tab) ? tab : allowedTabs[0]?.key
  const visibleTabMeta = ADMIN_TABS.find((item) => item.key === visibleTab)

  useEffect(() => {
    if (!account || !visibleTab || visibleTab === tab) return
    setTab(visibleTab)
    setSearchParams((current) => {
      const updated = new URLSearchParams(current)
      if (visibleTab === 'overview') updated.delete('tab')
      else updated.set('tab', visibleTab)
      return updated
    }, { replace: true })
  }, [account, setSearchParams, tab, visibleTab])

  const quickActions: OverviewAction[] = []
  if (allowedTabs.some((item) => item.key === 'control')) {
    quickActions.push({
      tab: 'control',
      label: '现场控制',
      description: qState === 'start' ? '答题正在进行，可结束本轮或广播现场通知' : '答题处于待机，可开始新一轮答题',
      meta: qState === 'start' ? '进行中' : '待开始',
    })
  }
  if (can('quiz.read')) {
    quickActions.push({
      tab: 'questions',
      label: '题库维护',
      description: '导入、新增、检索和启停题目',
      meta: '内容准备',
    })
  }
  if (can('site.read')) {
    quickActions.push({
      tab: 'site',
      label: '站点发布',
      description: '检查公开模块、首页内容编排与发布状态',
      meta: can('site.write') ? '可编辑' : '只读',
    })
  }
  if (can('lottery.configure')) {
    quickActions.push({
      tab: 'lottery',
      label: '活动运营',
      description: '配置号码大屏与个人抽取，执行逐级开奖和结果导出',
      meta: '活动工作台',
    })
  }

  if (authChecking) {
    return (
      <section className="admin">
        <div className="page-loading" role="status">正在验证管理员会话…</div>
      </section>
    )
  }

  if (!account) {
    return (
      <section className="admin">
        <div className="card admin-login">
          <p className="section-eyebrow">ADMIN CONSOLE</p>
          <h1>后台登录</h1>
          <p className="muted">使用管理员账号登录。密码只用于本次请求，不会写入浏览器存储。</p>
          <form
            className="name-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submitLogin()
            }}
          >
            <label className="field">
              用户名
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="field">
              密码
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={authBusy}>
              {authBusy ? '正在登录…' : '登录'}
            </button>
          </form>
          {msg && <p className="error" role="alert" aria-live="assertive">{msg}</p>}
        </div>
      </section>
    )
  }

  const feedbackError = msg.startsWith('✘')
  const feedbackText = msg.replace(/^[✔✘]\s*/, '')

  return (
    <section className="admin">
      <header className="admin-top">
        <div className="admin-top-inner">
          <div className="admin-title-block">
            <p className="section-eyebrow">ADMIN CONSOLE</p>
            <div className="admin-title-line">
              <h1>后台管理</h1>
              <p className="admin-identity">{account.username} · {roleLabel[account.role]}</p>
            </div>
          </div>
          <div className="admin-top-actions">
            <span className={`admin-live-state${qState === 'start' ? ' is-live' : ''}`}>
              <i aria-hidden="true" />
              答题{qState === 'start' ? '进行中' : '待开始'}
            </span>
            <button className="mini-btn" type="button" onClick={() => void logout()}>
              退出登录
            </button>
          </div>
        </div>
      </header>

      <div className="admin-workspace">
        <aside className="admin-sidebar" aria-label="后台工作区">
          <button
            ref={navToggleRef}
            className="admin-nav-toggle"
            type="button"
            aria-expanded={navOpen}
            aria-controls="admin-navigation"
            onClick={() => setNavOpen((open) => !open)}
          >
            <span>
              <small>当前功能</small>
              <strong>{visibleTabMeta?.label ?? '后台功能'}</strong>
            </span>
            <span className="admin-nav-toggle-action">{navOpen ? '收起' : '切换'}</span>
          </button>

          <div id="admin-navigation" className={`admin-nav-panel${navOpen ? ' is-open' : ''}`}>
            <div className="admin-nav-heading">
              <span>WORKSPACE</span>
              <strong>管理功能</strong>
            </div>
            <nav className="admin-nav" aria-label="后台功能">
              {ADMIN_GROUPS.map((group) => {
                const groupTabs = allowedTabs.filter((item) => item.group === group.key)
                if (groupTabs.length === 0) return null
                return (
                  <div className="admin-nav-group" key={group.key}>
                    <p>{group.label}</p>
                    {groupTabs.map((item) => {
                      const index = ADMIN_TABS.findIndex((candidate) => candidate.key === item.key) + 1
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`admin-nav-link${visibleTab === item.key ? ' on' : ''}`}
                          aria-current={visibleTab === item.key ? 'page' : undefined}
                          onClick={() => selectTab(item.key)}
                        >
                          <span aria-hidden="true">{String(index).padStart(2, '0')}</span>
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </nav>
            <div className="admin-nav-footer">
              <span>LIVE STATUS</span>
              <strong className={qState === 'start' ? 'is-live' : undefined}>
                <i aria-hidden="true" />
                {qState === 'start' ? '答题进行中' : '答题待开始'}
              </strong>
              <small>现场状态每 5 秒同步</small>
              {can('scores.read') && (
                <button
                  className="admin-utility-button"
                  type="button"
                  onClick={() => void download('/api/admin/export/scores', `scores-${Date.now()}.csv`)}
                >
                  <span>成绩数据</span>
                  <b>导出 CSV</b>
                </button>
              )}
            </div>
          </div>
        </aside>

        <div
          className="admin-content"
          ref={adminContentRef}
          tabIndex={-1}
          role="region"
          aria-label={`${visibleTabMeta?.label ?? '后台'}内容`}
        >
          {Object.keys(dataErrors).length > 0 && (
            <div className="admin-sync-warning" role="alert">
              <span>
                部分后台数据没有同步成功：{Object.values(dataErrors).join('；')}
              </span>
              <button className="mini-btn" type="button" onClick={() => void reloadAll()}>
                重新同步
              </button>
            </div>
          )}

      {visibleTab === 'overview' && ov && (
        <AdminOverview
          data={ov}
          quizState={qState}
          canReadAudit={can('audit.read')}
          loading={overviewLoading}
          updatedAt={overviewUpdatedAt}
          onRefresh={() => void loadOverview()}
          quickActions={quickActions}
          onNavigate={(destination) => selectTab(destination)}
          onExportScores={can('scores.read')
            ? () => void download('/api/admin/export/scores', `scores-${Date.now()}.csv`)
            : undefined}
        />
      )}

      {visibleTab === 'overview' && !ov && (
        <div className={`card admin-overview-state${overviewError ? ' error' : ''}`}>
          {overviewError ? (
            <>
              <h3>控制台概览暂时不可用</h3>
              <p className="error" role="alert">{overviewError}</p>
              <button className="btn btn-primary" type="button" onClick={() => void loadOverview()}>
                重新加载
              </button>
            </>
          ) : (
            <div className="admin-loading" role="status">正在同步控制台数据…</div>
          )}
        </div>
      )}

      {visibleTab === 'site' && (
        <SiteEditor
          canWrite={can('site.write')}
          can={can}
          onMessage={(message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`)}
          onSaved={reloadSite}
          onDirtyChange={setSiteDirty}
        />
      )}

      {visibleTab === 'access' && (
        <AccessPanel
          onMessage={(message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`)}
        />
      )}

      {visibleTab !== 'control' && moduleAdminPanels
        .filter((panel) => panel.tab === visibleTab && can(panel.permission))
        .map(({ key, Component }) => (
          <Component key={key} context={adminContext} />
        ))}

      {visibleTab === 'audit' && (
        <AuditPanel
          onMessage={(message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`)}
        />
      )}

            {visibleTab === 'control' && (
        <div className="card">
          <div className="panel-head">
            <div>
              <p className="section-eyebrow">LIVE OPERATIONS</p>
              <h2>现场控制</h2>
              <p className="muted">答题开关、现场提示、互动效果与招新工具集中在这里。</p>
            </div>
          </div>
          <div className="admin-grid">
            {moduleAdminPanels
              .filter((panel) => panel.tab === 'control' && can(panel.permission))
              .map(({ key, Component }) => (
                <Component key={key} context={adminContext} />
              ))}
          </div>
        </div>
      )}

      {visibleTab === 'appearance' && (
        <div className="card">
          <div className="admin-grid appearance-grid">
          <div className="admin-panel">
            <h3>站点 Logo</h3>
            <p className="muted">显示在顶栏、首页会徽与大屏标题；未上传时使用内置样式。</p>
            <label className="field">
              上传 Logo（PNG/JPG/WebP/GIF，建议透明背景、方形）
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files && e.target.files[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const url = await uploadImage(f)
                    await saveLogo(url)
                  } catch (err) {
                    setMsg(`✘ ${(err as Error).message}`)
                  }
                }}
              />
            </label>
            {logo ? (
              <>
                <img className="thumb big logo-preview" src={logo} alt="当前 Logo" />
                {can('site.write') && <button className="btn" onClick={() => void saveLogo('')}>
                  恢复内置 Logo
                </button>}
              </>
            ) : (
              <p className="muted">当前使用内置 Logo</p>
            )}
          </div>

          <div className="admin-panel">
            <div className="qbank-head">
              <h3>首页背景轮播</h3>
              {bgs.length > 0 && can('media.write') && (
                <button className="mini-btn danger" onClick={() => setWipe({ step: 'ask' })}>
                  一键清空
                </button>
              )}
            </div>
            <label className="field">
              {uploading ? '上传中…' : '批量上传图片（可多选，单张 ≤10MB）'}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading || !can('media.write')}
                onChange={(e) => void onPickBg(e)}
              />
            </label>
            <ul className="qlist">
              {bgs.map((b) => (
                <li key={b.id}>
                  <span className={b.active ? '' : 'muted'}>
                    {b.active ? '▶ ' : ''}
                    {b.file_path.split('/').pop()}
                  </span>
                  {can('media.write') && <span>
                    <button className="mini-btn" onClick={() => void toggleBg(b)}>
                      {b.active ? '停用' : '启用'}
                    </button>
                    <button className="mini-btn danger" onClick={() => requestDeleteBackground(b)}>
                      删除
                    </button>
                  </span>}
                </li>
              ))}
              {bgs.length === 0 && <li className="muted">暂无背景图，未上传时显示粒子动画</li>}
            </ul>
          </div>

          <div className="admin-panel appearance-footer">
            <h3>页脚信息</h3>
            <div className="appearance-footer-fields">
              <label className="field">
                拥有人 / 版权
                <input
                  value={footer.owner}
                  readOnly={!can('site.write')}
                  onChange={(e) => setFooter({ ...footer, owner: e.target.value })}
                  placeholder="计算机协会 · 汕头职业技术学院"
                />
              </label>
              <label className="field">
                开源协议
                <input
                  value={footer.license}
                  readOnly={!can('site.write')}
                  onChange={(e) => setFooter({ ...footer, license: e.target.value })}
                  placeholder="开源协议：MIT"
                />
              </label>
              <label className="field">
                ICP 备案号（留空隐藏）
                <input
                  value={footer.icp}
                  readOnly={!can('site.write')}
                  onChange={(e) => setFooter({ ...footer, icp: e.target.value })}
                  placeholder="粤ICP备XXXXXXXX号"
                />
              </label>
              <label className="field">
                ICP 备案图标（后台上传）
                <input
                  type="file"
                  accept="image/*"
                  disabled={!can('site.write')}
                  onChange={async (e) => {
                    const f = e.target.files && e.target.files[0]
                    if (!f) return
                    try {
                      const url = await uploadImage(f)
                      setFooter({ ...footer, icp_icon: url })
                      setMsg('✔ ICP 图标已上传，记得点保存')
                    } catch (err) {
                      setMsg(`✘ ${(err as Error).message}`)
                    }
                  }}
                />
                {footer.icp_icon && <img className="thumb" src={footer.icp_icon} alt="ICP 图标预览" />}
              </label>
              <label className="field">
                公安备案号（留空隐藏）
                <input
                  value={footer.police}
                  readOnly={!can('site.write')}
                  onChange={(e) => setFooter({ ...footer, police: e.target.value })}
                  placeholder="粤公网安备 XXXXXXXXXXXX号"
                />
              </label>
              <label className="field">
                公安备案图标（后台上传）
                <input
                  type="file"
                  accept="image/*"
                  disabled={!can('site.write')}
                  onChange={async (e) => {
                    const f = e.target.files && e.target.files[0]
                    if (!f) return
                    try {
                      const url = await uploadImage(f)
                      setFooter({ ...footer, police_icon: url })
                      setMsg('✔ 公安图标已上传，记得点保存')
                    } catch (err) {
                      setMsg(`✘ ${(err as Error).message}`)
                    }
                  }}
                />
                {footer.police_icon && <img className="thumb" src={footer.police_icon} alt="公安图标预览" />}
              </label>
            </div>
            {can('site.write') && <button className="btn btn-accent" onClick={() => void saveFooter()}>
              保存页脚
            </button>}
          </div>
          <MediaPanel
            canWrite={can('media.write')}
            onMessage={(message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`)}
          />
        </div>
      </div>
      )}

        </div>
      </div>

      {msg && createPortal(
        <div
          className={`admin-feedback admin-toast${feedbackError ? ' error' : ' ok'}`}
          role={feedbackError ? 'alert' : 'status'}
          aria-live={feedbackError ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="admin-feedback-kind">{feedbackError ? '错误' : '完成'}</span>
          <span className="admin-feedback-copy">{feedbackText}</span>
          <button type="button" aria-label="关闭操作提示" onClick={() => setMsg('')}>×</button>
        </div>,
        document.body,
      )}

      {wipe && (
        <div className="modal-veil" onClick={() => setWipe(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            {wipe.step === 'ask' ? (
              <>
                <h3 id="admin-confirm-title">清空全部背景图？</h3>
                <ul className="side-effects">
                  <li>将删除全部 <b>{bgs.length} 张背景图</b>（含上传文件）</li>
                  <li>首页将回退为<b>粒子动画</b>背景</li>
                  <li>此操作<b>不可恢复</b></li>
                </ul>
                <div className="modal-actions">
                  <button className="btn" type="button" autoFocus onClick={() => setWipe(null)}>取消</button>
                  <button className="btn btn-primary" type="button" onClick={() => setWipe({ ...wipe, step: 'final' })}>继续</button>
                </div>
              </>
            ) : (
              <>
                <h3 id="admin-confirm-title">最后确认</h3>
                <p className="muted">再次确认：确定清空全部背景图吗？此操作不可恢复。</p>
                <div className="modal-actions">
                  <button className="btn" type="button" autoFocus onClick={() => setWipe({ ...wipe, step: 'ask' })}>返回</button>
                  <button className="btn btn-danger" type="button" onClick={() => void confirmWipe()}>确认清空</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {confirmRequest && (
        <ConfirmDialog
          title={confirmRequest.title}
          message={confirmRequest.message}
          confirmLabel={confirmRequest.confirmLabel}
          tone={confirmRequest.tone}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            const action = confirmRequest.action
            setConfirmRequest(null)
            void action()
          }}
        />
      )}
    </section>
  )
}
