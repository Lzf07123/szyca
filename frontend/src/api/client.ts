const TOKEN_KEY = 'quiz_token'
const PENDING_KEY = 'quiz_pending_answers'
const FP_KEY = 'device_fp'
let csrfToken = ''

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string) {
  sessionStorage.setItem(TOKEN_KEY, t)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

export function setCSRFToken(value: string) {
  csrfToken = value
}

export function clearCSRFToken() {
  csrfToken = ''
}

export function csrfHeader(): Record<string, string> {
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
}

export function getDeviceFP(): string {
  let fp = localStorage.getItem(FP_KEY)
  if (!fp) {
    fp = randomID()
    localStorage.setItem(FP_KEY, fp)
  }
  return fp
}

export function randomID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (csrfToken && opts.method && !['GET', 'HEAD', 'OPTIONS'].includes(opts.method.toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  const res = await fetch(path, { credentials: 'same-origin', ...opts, headers })
  let body: any = {}
  try {
    body = await res.json()
  } catch {
    /* 空响应 */
  }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`) as Error & {
      status?: number
      code?: string
    }
    err.status = res.status
    if (body && body.code) err.code = body.code
    throw err
  }
  return body as T
}

// ---------- 幂等提交缓冲：断网不丢分 ----------

export interface PendingAnswer {
  request_id: string
  question_id: number
  selected: number | null
}

export function loadPending(): PendingAnswer[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')
  } catch {
    return []
  }
}

function savePending(q: PendingAnswer[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(q))
}

export function pushPending(a: PendingAnswer) {
  const q = loadPending()
  if (q.some((item) => item.request_id === a.request_id)) return
  q.push(a)
  savePending(q)
}

export function removePending(requestID: string) {
  savePending(loadPending().filter((item) => item.request_id !== requestID))
}

export async function flushPending(): Promise<number> {
  const q = loadPending()
  const rest: PendingAnswer[] = []
  let ok = 0
  for (const a of q) {
    try {
      await api('/api/answer', { method: 'POST', body: JSON.stringify(a) })
      ok++
    } catch (e) {
      const err = e as Error & { status?: number }
      // 4xx 表示答案已过期、题序变化或身份失效，继续重试不会成功；只保留瞬时网络/服务端错误。
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) continue
      rest.push(a)
    }
  }
  savePending(rest)
  return ok
}
