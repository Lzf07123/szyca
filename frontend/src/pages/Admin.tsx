import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { api, clearCSRFToken, csrfHeader, setCSRFToken } from '../api/client'
import { setFavicon, useSite } from '../api/site'
import { usePageMeta } from '../components/PageMeta'
import AccessPanel from './admin/AccessPanel'
import AdminLottery from './admin/AdminLottery'
import AdminOverview, { type OverviewAction } from './admin/AdminOverview'
import AuditPanel from './admin/AuditPanel'
import MediaPanel from './admin/MediaPanel'
import SiteEditor from './admin/SiteEditor'

interface Bg {
  id: number
  file_path: string
  active: boolean
}

interface Qr {
  id: number
  title: string
  image_url: string
  active: boolean
}

interface Question {
  id: number
  content: string
  options: string[]
  answer: number
  score: number
  active: boolean
  difficulty: string
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

type AdminTab = 'overview' | 'control' | 'questions' | 'site' | 'lottery' | 'appearance' | 'access' | 'audit'

const ADMIN_TABS: Array<{ key: AdminTab; label: string; permission: string }> = [
  { key: 'overview', label: '概览', permission: 'site.read' },
  { key: 'control', label: '现场控制', permission: 'quiz.operate' },
  { key: 'lottery', label: '抽奖', permission: 'lottery.configure' },
  { key: 'site', label: '站点内容', permission: 'site.read' },
  { key: 'questions', label: '题库', permission: 'quiz.read' },
  { key: 'appearance', label: '媒体与外观', permission: 'media.read' },
  { key: 'access', label: '管理员', permission: 'access.manage' },
  { key: 'audit', label: '审计', permission: 'audit.read' },
]

const ADMIN_GROUPS: Array<{ label: string; key: string; tabs: AdminTab[] }> = [
  { key: 'operations', label: '现场运营', tabs: ['overview', 'control', 'lottery'] },
  { key: 'content', label: '内容维护', tabs: ['site', 'questions', 'appearance'] },
  { key: 'governance', label: '系统治理', tabs: ['access', 'audit'] },
]

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
  const [wipe, setWipe] = useState<{ target: 'questions' | 'bgs'; step: 'ask' | 'final' } | null>(null)
  const [qState, setQState] = useState<'start' | 'stop'>('stop')
  const [qBusy, setQBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dataErrors, setDataErrors] = useState<Record<string, string>>({})
  const [siteDirty, setSiteDirty] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [questionsLoading, setQuestionsLoading] = useState(true)
  const [questionQuery, setQuestionQuery] = useState('')
  const [questionDifficulty, setQuestionDifficulty] = useState('全部')
  const [questionStatus, setQuestionStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [content, setContent] = useState('')
  const [options, setOptions] = useState('')
  const [answerIdx, setAnswerIdx] = useState(0)
  const [score, setScore] = useState(10)
  const [difficulty, setDifficulty] = useState('简单')
  const [bgs, setBgs] = useState<Bg[]>([])
  const [uploading, setUploading] = useState(false)
  const [footer, setFooter] = useState({ owner: '', license: '', icp: '', icp_icon: '', police: '', police_icon: '' })
  const [qrs, setQrs] = useState<Qr[]>([])
  const [qrNewTitle, setQrNewTitle] = useState('')
  const [qrTitles, setQrTitles] = useState<Record<number, string>>({})
  const [logo, setLogo] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [announcing, setAnnouncing] = useState(false)
  const verified = account !== null

  const can = useCallback((permission: string) => {
    if (!account) return false
    return account.capabilities.includes('*') || account.capabilities.includes(permission)
  }, [account])

  const selectTab = useCallback((next: AdminTab) => {
    if (tab === 'site' && next !== 'site' && siteDirty && !window.confirm('站点内容还有未保存修改。离开后这些修改将丢失，确定继续吗？')) {
      return
    }
    setTab(next)
    setNavOpen(false)
    setMsg((current) => current.startsWith('✔') ? '' : current)
    window.requestAnimationFrame(() => {
      adminContentRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
      adminContentRef.current?.focus({ preventScroll: true })
    })
    setSearchParams((current) => {
      const updated = new URLSearchParams(current)
      if (next === 'overview') updated.delete('tab')
      else updated.set('tab', next)
      return updated
    }, { replace: true })
  }, [setSearchParams, siteDirty, tab])

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
      adminContentRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
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

  const logout = async () => {
    if (siteDirty && !window.confirm('站点内容还有未保存修改。退出登录会丢失这些修改，确定继续吗？')) {
      return
    }
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

  const switchState = async (next: 'start' | 'stop') => {
    if (qBusy) return
    if (next === 'stop' && !window.confirm('结束答题后，所有尚未提交的答案将被拒绝。确定现在结束吗？')) {
      return
    }
    setQBusy(true)
    setMsg('')
    try {
      await api('/api/admin/quiz-state', {
        method: 'POST',
        body: JSON.stringify({ state: next }),
      })
      setQState(next)
      setMsg(next === 'start' ? '✔ 答题已开始，参与者可进入答题' : '✔ 答题已结束，未提交答案已停止接收')
      void loadOverview()
    } catch (cause) {
      setMsg(`✘ ${(cause as Error).message}`)
    } finally {
      setQBusy(false)
    }
  }

  const reload = useCallback(async () => {
    if (!can('quiz.read')) return
    setQuestionsLoading(true)
    try {
      const d = await api<{ questions: Question[] }>('/api/admin/questions')
      setQuestions(d.questions)
      clearLoadFailure('questions')
    } catch (cause) {
      reportLoadFailure('questions', cause)
    } finally {
      setQuestionsLoading(false)
    }
  }, [can, clearLoadFailure, reportLoadFailure])

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

  const reloadQrs = useCallback(async () => {
    if (!can('site.read')) return
    try {
      const d = await api<{ qrcodes: Qr[] }>('/api/admin/qrcodes')
      const list = d.qrcodes || []
      setQrs(list)
      setQrTitles(Object.fromEntries(list.map((q) => [q.id, q.title])))
      clearLoadFailure('qrcodes')
    } catch (cause) {
      reportLoadFailure('qrcodes', cause)
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
      reload(),
      reloadBgs(),
      reloadFooter(),
      reloadQrs(),
      reloadLogo(),
    ])
  }, [loadOverview, reload, reloadBgs, reloadFooter, reloadLogo, reloadQrs])

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

  const toggleBg = (b: Bg) =>
    void act(`/api/admin/backgrounds/${b.id}/active`, { active: !b.active }, b.active ? '背景已停用' : '背景已启用')

  const delBg = async (b: Bg) => {
    if (!window.confirm(`确定删除背景图「${b.file_path.split('/').pop() || b.id}」？此操作不可恢复。`)) return
    try {
      await api(`/api/admin/backgrounds/${b.id}`, { method: 'DELETE' })
      setMsg('✔ 背景已删除')
      void reloadBgs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  // 二维码（加入我们）：新增 / 改标题 / 换图 / 停启用 / 删除
  const addQr = async (f: File) => {
    const fd = new FormData()
    fd.append('file', f)
    fd.append('title', qrNewTitle)
    try {
      const res = await fetch('/api/admin/qrcodes', {
        method: 'POST',
        headers: csrfHeader(),
        body: fd,
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(b.error || `HTTP ${res.status}`)
      }
      setQrNewTitle('')
      setMsg('✔ 二维码已新增并默认启用，前台 30 秒内生效')
      void reloadQrs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const saveQrTitle = async (q: Qr) => {
    try {
      await api(`/api/admin/qrcodes/${q.id}`, {
        method: 'POST',
        body: JSON.stringify({ title: qrTitles[q.id] ?? '' }),
      })
      setMsg('✔ 标题已保存')
      void reloadQrs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const replaceQrImage = async (q: Qr, f: File) => {
    try {
      const url = await uploadImage(f)
      await api(`/api/admin/qrcodes/${q.id}`, {
        method: 'POST',
        body: JSON.stringify({ image_url: url }),
      })
      setMsg('✔ 二维码图片已更换')
      void reloadQrs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const toggleQr = async (q: Qr) => {
    try {
      await api(`/api/admin/qrcodes/${q.id}`, {
        method: 'POST',
        body: JSON.stringify({ active: !q.active }),
      })
      setMsg(`✔ ${q.active ? '二维码已停用' : '二维码已启用'}`)
      void reloadQrs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const delQr = async (q: Qr) => {
    if (!window.confirm(`确定删除二维码「${q.title || `#${q.id}`}」？此操作不可恢复。`)) return
    try {
      await api(`/api/admin/qrcodes/${q.id}`, { method: 'DELETE' })
      setMsg('✔ 二维码已删除')
      void reloadQrs()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
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

  // 批量导入题目 CSV
  const importQuestions = async (f: File) => {
    const fd = new FormData()
    fd.append('file', f)
    try {
      const res = await fetch('/api/admin/questions/import', {
        method: 'POST',
        headers: csrfHeader(),
        body: fd,
      })
      const d = await res.json().catch(() => ({ error: '导入失败' }))
      if (!res.ok) {
        setMsg(`✘ ${d.error || '导入失败'}`)
        return
      }
      const failed = (d.failed || []) as Array<{ line: number; error: string }>
      if (failed.length) {
        setMsg(`✘ 导入完成：成功 ${d.imported} 题；失败 ${failed.length} 行（第 ${failed.map((x) => x.line).join('、')} 行）`)
      } else {
        setMsg(`✔ 导入成功：${d.imported} 题`)
      }
      void reload()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  const confirmWipe = async () => {
    if (!wipe) return
    const target = wipe.target
    setWipe(null)
    try {
      if (target === 'questions') {
        const d = await api<{ questions_deleted: number }>('/api/admin/questions', {
          method: 'DELETE',
        })
        setMsg(`✔ 已清空 ${d.questions_deleted} 道题目（排行榜与答题记录保留）`)
        void reload()
      } else {
        const d = await api<{ backgrounds_deleted: number }>('/api/admin/backgrounds', {
          method: 'DELETE',
        })
        setMsg(`✔ 已清空 ${d.backgrounds_deleted} 张背景图`)
        void reloadBgs()
      }
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  async function act(path: string, body: any, okMsg: string) {
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) })
      setMsg(`✔ ${okMsg}`)
      void reload()
    } catch (e) {
      setMsg(`✘ ${(e as Error).message}`)
    }
  }

  async function broadcastAnnouncement() {
    const content = announcement.trim()
    if (!content || announcing) return
    setAnnouncing(true)
    setMsg('')
    try {
      await api('/api/admin/announce', {
        method: 'POST',
        body: JSON.stringify({ content, type: 'info' }),
      })
      setAnnouncement('')
      setMsg('✔ 公告已广播到答题页与现场大屏')
    } catch (cause) {
      setMsg(`✘ ${(cause as Error).message}`)
    } finally {
      setAnnouncing(false)
    }
  }

  const filteredQuestions = useMemo(() => {
    const query = questionQuery.trim().toLocaleLowerCase('zh-CN')
    return questions.filter((question) => {
      if (questionDifficulty !== '全部' && question.difficulty !== questionDifficulty) return false
      if (questionStatus === 'active' && !question.active) return false
      if (questionStatus === 'inactive' && question.active) return false
      return !query || question.content.toLocaleLowerCase('zh-CN').includes(query)
    })
  }, [questionDifficulty, questionQuery, questionStatus, questions])

  const draftOptions = options.split('\n').map((option) => option.trim()).filter(Boolean)
  const answerOption = draftOptions[answerIdx]
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
      description: questionsLoading ? '正在同步题目状态' : `${questions.filter((question) => question.active).length} / ${questions.length} 道题启用`,
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
      description: '配置资格与库存，处理领取核销和结果导出',
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
                const groupTabs = allowedTabs.filter((item) => group.tabs.includes(item.key))
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
          canManageLottery={can('lottery.configure')}
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

      {visibleTab === 'lottery' && (
        <AdminLottery
          onMessage={(message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`)}
          onSiteChanged={reloadSite}
        />
      )}

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
          <div className="admin-panel">
            <h3>答题控制</h3>
            <p className="muted" role="status" aria-live="polite">
              当前状态：
              <b className={qState === 'start' ? 'state-live' : 'state-idle'}>
                {qState === 'start' ? '答题进行中' : '答题未开始'}
              </b>
            </p>
            <button
              className="btn btn-accent"
              type="button"
              disabled={qState === 'start' || qBusy}
              onClick={() => void switchState('start')}
            >
              {qBusy ? '处理中…' : '开始答题'}
            </button>
            <button
              className="btn btn-danger-outline"
              type="button"
              disabled={qState === 'stop' || qBusy}
              onClick={() => void switchState('stop')}
            >
              结束答题
            </button>
          </div>

          <div className="admin-panel">
            <h3>特效</h3>
            <button className="btn" onClick={() => void act('/api/admin/effect', { kind: 'confetti' }, '已触发彩蛋特效')}>
              全屏庆祝特效
            </button>
          </div>

          <div className="admin-panel">
            <h3>公告</h3>
            <p className="muted">公告会同时推送到答题页与现场大屏，最多 200 字。</p>
            <label className="field">
              公告内容
              <textarea
                rows={3}
                maxLength={200}
                value={announcement}
                placeholder="如：本轮答题将在 5 分钟后结束，请抓紧提交。"
                onChange={(event) => setAnnouncement(event.target.value)}
              />
            </label>
            <p className="field-hint">{announcement.length} / 200</p>
            <button
              className="btn"
              type="button"
              disabled={!announcement.trim() || announcing}
              onClick={() => void broadcastAnnouncement()}
            >
              {announcing ? '正在广播…' : '广播公告'}
            </button>
          </div>

          {can('site.write') && <div className="admin-panel">
            <h3>加入我们 · 二维码</h3>
            <p className="muted">标题展示在二维码下方；启用中的二维码会全部出现在「加入我们」页。</p>
            <label className="field">
              新增标题（可留空，最多 30 字）
              <input
                value={qrNewTitle}
                maxLength={30}
                placeholder="如：招新群① / QQ群 / 公众号"
                onChange={(e) => setQrNewTitle(e.target.value)}
              />
            </label>
            <label className="field">
              上传图片（新增一条，默认启用）
              <input
                type="file"
                accept="image/*"
                disabled={!can('site.write')}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0]
                  e.target.value = ''
                  if (f) void addQr(f)
                }}
              />
            </label>
            <ul className="qlist">
              {qrs.map((q) => (
                <li key={q.id}>
                  <span className="qr-row">
                    <img className="thumb" src={q.image_url} alt="" />
                    <input
                      className="qr-title-input"
                      value={qrTitles[q.id] ?? ''}
                      maxLength={30}
                      placeholder="标题（可留空）"
                      onChange={(e) => setQrTitles({ ...qrTitles, [q.id]: e.target.value })}
                    />
                  </span>
                  <span className="qr-actions">
                    <button className="mini-btn" onClick={() => void saveQrTitle(q)}>
                      保存标题
                    </button>
                    <label className="mini-btn">
                      换图
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files && e.target.files[0]
                          e.target.value = ''
                          if (f) void replaceQrImage(q, f)
                        }}
                      />
                    </label>
                    <button className="mini-btn" onClick={() => void toggleQr(q)}>
                      {q.active ? '停用' : '启用'}
                    </button>
                    <button className="mini-btn danger" onClick={() => void delQr(q)}>
                      删除
                    </button>
                  </span>
                </li>
              ))}
              {qrs.length === 0 && <li className="muted">暂无二维码，上传后「加入我们」页即可扫码</li>}
            </ul>
          </div>}

      </div>
      </div>
      )}

      {visibleTab === 'appearance' && (
        <div className="card">
          <div className="admin-grid">
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
            <h3>页脚信息</h3>
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
              公安备案号（如：粤公网安备 4405XXXXXXXXXX号）
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
            {can('site.write') && <button className="btn btn-accent" onClick={() => void act('/api/admin/footer', footer, '页脚信息已更新')}>
              保存页脚
            </button>}
          </div>

          <div className="admin-panel">
            <div className="qbank-head">
              <h3>首页背景轮播</h3>
              {bgs.length > 0 && can('media.write') && (
                <button className="mini-btn danger" onClick={() => setWipe({ target: 'bgs', step: 'ask' })}>
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
                    <button className="mini-btn danger" onClick={() => void delBg(b)}>
                      删除
                    </button>
                  </span>}
                </li>
              ))}
              {bgs.length === 0 && <li className="muted">暂无背景图，未上传时显示粒子动画</li>}
            </ul>
          </div>
          <MediaPanel
            canWrite={can('media.write')}
            onMessage={(message, error) => setMsg(`${error ? '✘' : '✔'} ${message}`)}
          />
        </div>
      </div>
      )}

      {visibleTab === 'questions' && (
      <div className="card">
        <div className="qbank-head">
          <div>
            <h3>题库（{questions.length}）</h3>
            <p className="muted">启用中 {questions.filter((question) => question.active).length} 题 · 当前筛选 {filteredQuestions.length} 题</p>
          </div>
          {can('quiz.write') && (
            <button className="mini-btn danger" type="button" onClick={() => setWipe({ target: 'questions', step: 'ask' })}>
              一键清空题库
            </button>
          )}
        </div>
        <div className="admin-grid">
          {can('quiz.write') && <div className="admin-panel">
            <h3>批量导入题目</h3>
            <p className="muted">
              CSV 列：题目, 选项A~F, 正确答案(A-F), 难度, 分值。题目以「示例」开头的行自动跳过。
            </p>
            <div className="field-actions">
              <button className="btn" type="button" onClick={() => void download('/api/admin/questions/template', 'questions-template.csv')}>
                下载模板
              </button>
              <label className="field">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0]
                    if (f) void importQuestions(f)
                  }}
                />
              </label>
            </div>
          </div>}

          {can('quiz.write') && <div className="admin-panel">
            <h3>新增题目</h3>
            <label className="field">
              题目
              <input value={content} onChange={(e) => setContent(e.target.value)} />
            </label>
            <label className="field">
              选项（每行一个）
              <textarea
                rows={4}
                value={options}
                onChange={(e) => {
                  const nextOptions = e.target.value.split('\n').map((option) => option.trim()).filter(Boolean)
                  setOptions(e.target.value)
                  if (answerIdx >= nextOptions.length) setAnswerIdx(Math.max(0, nextOptions.length - 1))
                }}
              />
            </label>
            <label className="field">
              正确答案
              <select
                value={answerIdx}
                disabled={draftOptions.length === 0}
                onChange={(e) => setAnswerIdx(Number(e.target.value))}
              >
                {draftOptions.length === 0 && <option value={0}>请先填写选项</option>}
                {draftOptions.map((option, index) => (
                  <option key={`${index}-${option}`} value={index}>
                    {String.fromCharCode(65 + index)}. {option}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {answerOption ? `当前正确项：${String.fromCharCode(65 + answerIdx)}. ${answerOption}` : '填写选项后可直接选择正确答案'}
              </span>
            </label>
            <label className="field">
              分值
              <input type="number" min={1} value={score} onChange={(e) => setScore(Number(e.target.value))} />
            </label>
            <label className="field">
              难度
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {['容易', '简单', '困难'].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!content.trim() || draftOptions.length < 2 || answerIdx >= draftOptions.length || score < 1}
              onClick={() =>
                void act(
                  '/api/admin/questions',
                  { content, options: draftOptions, answer: answerIdx, score, difficulty },
                  '题目已添加',
                )
              }
            >
              添加题目
            </button>
          </div>}

          <div className="admin-panel">
            <h3>题目列表</h3>
            <div className="question-filters">
              <label className="field">
                搜索题目
                <input
                  type="search"
                  value={questionQuery}
                  placeholder="输入题目关键字"
                  onChange={(event) => setQuestionQuery(event.target.value)}
                />
              </label>
              <label className="field">
                难度
                <select value={questionDifficulty} onChange={(event) => setQuestionDifficulty(event.target.value)}>
                  {['全部', '容易', '简单', '困难'].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                状态
                <select
                  value={questionStatus}
                  onChange={(event) => setQuestionStatus(event.target.value as typeof questionStatus)}
                >
                  <option value="all">全部</option>
                  <option value="active">启用中</option>
                  <option value="inactive">已停用</option>
                </select>
              </label>
            </div>
            {questionsLoading ? (
              <div className="admin-loading" role="status">正在读取题库…</div>
            ) : (
              <ul className="qlist">
                {filteredQuestions.map((q) => (
                  <li key={q.id} title={q.content}>
                    <span className={q.active ? '' : 'muted'}>
                      <i className={`qdiff d-${q.difficulty}`}>{q.difficulty}</i> #{q.id} {q.content.slice(0, 16)}
                      {q.content.length > 16 ? '…' : ''}
                    </span>
                    {can('quiz.write') && (
                      <button
                        className="mini-btn"
                        type="button"
                        onClick={() => void act(`/api/admin/questions/${q.id}/active`, { active: !q.active }, q.active ? '已停用' : '已启用')}
                      >
                        {q.active ? '停用' : '启用'}
                      </button>
                    )}
                  </li>
                ))}
                {filteredQuestions.length === 0 && (
                  <li className="muted">
                    {questions.length === 0 ? '题库为空，请先导入或新增题目。' : '没有符合当前筛选条件的题目。'}
                  </li>
                )}
              </ul>
            )}
          </div>
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
                <h3 id="admin-confirm-title">{wipe.target === 'questions' ? '清空全部题库？' : '清空全部背景图？'}</h3>
                <ul className="side-effects">
                  {wipe.target === 'questions' ? (
                    <>
                      <li>将删除全部 <b>{questions.length} 道题目</b></li>
                      <li><b>答题记录与排行榜完整保留</b>，已答成绩不受影响</li>
                      <li>清空后<b>不会重新播种</b>内置示例题，请随后导入正式题库</li>
                    </>
                  ) : (
                    <>
                      <li>将删除全部 <b>{bgs.length} 张背景图</b>（含上传文件）</li>
                      <li>首页将回退为<b>粒子动画</b>背景</li>
                    </>
                  )}
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
                <p className="muted">
                  再次确认：确定清空全部{wipe.target === 'questions' ? '题目' : '背景图'}吗？此操作不可恢复。
                </p>
                <div className="modal-actions">
                  <button className="btn" type="button" autoFocus onClick={() => setWipe({ ...wipe, step: 'ask' })}>返回</button>
                  <button className="btn btn-danger" type="button" onClick={() => void confirmWipe()}>确认清空</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
