import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api } from '../../api/client'

export interface AdminOverviewData {
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

interface AuditEntry {
  id: number
  actor_name: string
  action: string
  resource_type: string
  resource_id: string
  created_at: string
}

interface AdminOverviewProps {
  data: AdminOverviewData
  quizState: 'start' | 'stop'
  canReadAudit: boolean
}

type DeltaKey = 'users' | 'participants' | 'attempts' | 'online'

export default function AdminOverview({ data, quizState, canReadAudit }: AdminOverviewProps) {
  const previous = useRef<AdminOverviewData['overview'] | null>(null)
  const [deltas, setDeltas] = useState<Record<DeltaKey, number>>({
    users: 0,
    participants: 0,
    attempts: 0,
    online: 0,
  })
  const [audit, setAudit] = useState<AuditEntry[]>([])

  useEffect(() => {
    const current = data.overview
    const last = previous.current
    if (last) {
      setDeltas({
        users: current.users - last.users,
        participants: current.participants - last.participants,
        attempts: current.attempts - last.attempts,
        online: current.online - last.online,
      })
    }
    previous.current = current
  }, [data.overview])

  useEffect(() => {
    if (!canReadAudit) return
    void api<{ entries: AuditEntry[] }>('/api/admin/audit?limit=5')
      .then((result) => setAudit(result.entries))
      .catch(() => undefined)
  }, [canReadAudit])

  const stats: Array<{ key: DeltaKey; label: string; code: string; value: number }> = [
    { key: 'users', label: '注册用户', code: 'USERS', value: data.overview.users },
    { key: 'participants', label: '参与答题', code: 'PLAYERS', value: data.overview.participants },
    { key: 'attempts', label: '累计作答', code: 'ANSWERS', value: data.overview.attempts },
    { key: 'online', label: '实时在线', code: 'CONNECTED', value: data.overview.online },
  ]

  const bars = [
    { label: '用户', code: 'USR', value: data.overview.users },
    { label: '参与者', code: 'PLY', value: data.overview.participants },
    { label: '在线', code: 'NET', value: data.overview.online },
    { label: '题库', code: 'QST', value: data.overview.questions },
    { label: '影像', code: 'IMG', value: data.overview.backgrounds },
  ]
  const maxBar = Math.max(...bars.map((item) => item.value), 1)
  const participation = data.overview.users > 0
    ? Math.min(100, Math.round((data.overview.participants / data.overview.users) * 100))
    : 0

  const checks = [
    { label: 'DATABASE', code: 'postgres', value: data.overview.db, ok: data.overview.db === 'ok' },
    { label: 'CACHE', code: 'redis', value: data.overview.redis, ok: data.overview.redis === 'ok' },
    {
      label: 'QUIZ_STATE',
      code: 'quiz',
      value: quizState === 'start' ? 'active' : 'standby',
      ok: quizState === 'start',
    },
    { label: 'MEMORY', code: 'runtime', value: `${data.mem_mb} MB`, ok: true },
    { label: 'GOROUTINES', code: 'workers', value: String(data.goroutines), ok: true },
    { label: 'UPTIME', code: 'service', value: data.uptime, ok: true },
  ]

  const logLines = [
    '$ nebulactl status --all',
    `[OK] postgres / ${data.overview.db}`,
    `[OK] redis / ${data.overview.redis}`,
    `[LIVE] websocket / ${data.overview.online} connected`,
    `[STATE] quiz / ${quizState === 'start' ? 'running' : 'standby'}`,
    `[INFO] questions / ${data.overview.questions} active`,
    ...audit.slice(0, 3).map((entry) => {
      const time = new Date(entry.created_at).toLocaleTimeString('zh-CN', { hour12: false })
      return `[${time}] ${entry.actor_name} -> ${entry.action} / ${entry.resource_type}${entry.resource_id ? `#${entry.resource_id}` : ''}`
    }),
    '> _',
  ]

  return (
    <section className="admin-overview" aria-labelledby="overview-title">
      <div className="workbench-head">
        <div>
          <p className="section-command"><span>$</span> systemctl status nebula_os</p>
          <h2 id="overview-title">控制台概览 <span>WORKBENCH</span></h2>
        </div>
        <div className="workbench-live"><i aria-hidden="true" /> LIVE · 10s REFRESH</div>
      </div>

      <div className="stat-grid">
        {stats.map((stat) => {
          const delta = deltas[stat.key]
          const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
          return (
            <article className="stat-card" key={stat.key}>
              <div className="stat-meta">
                <span>[{stat.code}]</span>
                <span>{stat.label}</span>
              </div>
              <strong>{stat.value.toLocaleString('zh-CN')}</strong>
              <div className={`stat-delta ${direction}`}>
                <span aria-hidden="true">{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'}</span>
                <b>{direction === 'flat' ? '稳定' : Math.abs(delta)}</b>
                <small>较上次刷新</small>
              </div>
            </article>
          )
        })}
      </div>

      <div className="chart-grid">
        <article className="admin-chart-card bar-card">
          <div className="chart-head">
            <div>
              <p className="section-label">LIVE METRICS / 02</p>
              <h3>活动数据脉冲</h3>
            </div>
            <code>COUNT / REAL</code>
          </div>
          <div
            className="activity-bars"
            role="img"
            aria-label={bars.map((item) => `${item.label} ${item.value}`).join('，')}
          >
            {bars.map((item, index) => (
              <div className="bar-column" key={item.code}>
                <b>{item.value}</b>
                <div className="bar-track">
                  <i
                    style={{
                      '--bar-size': `${Math.max(7, Math.round((item.value / maxBar) * 100))}%`,
                      transitionDelay: `${index * 70}ms`,
                    } as CSSProperties}
                  />
                </div>
                <span>{item.code}</span>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-chart-card rate-card">
          <div className="chart-head">
            <div>
              <p className="section-label">PARTICIPATION / 03</p>
              <h3>参与转化</h3>
            </div>
            <code>RATIO</code>
          </div>
          <div className="rate-body">
            <div
              className="donut-chart"
              style={{ '--rate': `${participation * 3.6}deg` } as CSSProperties}
              role="img"
              aria-label={`参与答题人数占注册用户的 ${participation}%`}
            >
              <div>
                <strong>{participation}%</strong>
                <span>PARTICIPATION</span>
              </div>
            </div>
            <dl className="rate-legend">
              <div><dt>已参与</dt><dd>{data.overview.participants}</dd></div>
              <div><dt>总用户</dt><dd>{data.overview.users}</dd></div>
              <div><dt>当前在线</dt><dd>{data.overview.online}</dd></div>
            </dl>
          </div>
        </article>
      </div>

      <div className="overview-lower">
        <article className="runtime-table-card">
          <div className="chart-head">
            <div>
              <p className="section-label">SYSTEM MATRIX / 04</p>
              <h3>运行状态</h3>
            </div>
            <code>HEALTH CHECK</code>
          </div>
          <div className="runtime-table-wrap">
            <table className="runtime-table">
              <thead>
                <tr><th scope="col">模块</th><th scope="col">标识</th><th scope="col">当前值</th><th scope="col">状态</th></tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.label}>
                    <td><code>{check.label}</code></td>
                    <td>{check.code}</td>
                    <td>{check.value}</td>
                    <td>
                      <span className={`status-pill ${check.ok ? 'ok' : 'idle'}`}>
                        <i aria-hidden="true" />
                        {check.ok ? '正常' : '待机'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="terminal-log-card">
          <div className="chart-head">
            <div>
              <p className="section-label">EVENT STREAM / 05</p>
              <h3>终端日志</h3>
            </div>
            <code>TAIL -F</code>
          </div>
          <pre aria-label="系统终端日志"><code>{logLines.join('\n')}</code></pre>
        </article>
      </div>
    </section>
  )
}
