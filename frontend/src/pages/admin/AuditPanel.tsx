import { useEffect, useState } from 'react'
import { api } from '../../api/client'

interface Entry {
  id: number
  actor_name: string
  action: string
  resource_type: string
  resource_id: string
  request_id: string
  ip: string
  created_at: string
  before: unknown
  after: unknown
}

export default function AuditPanel({ onMessage }: { onMessage: (message: string, error?: boolean) => void }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api<{ entries: Entry[] }>('/api/admin/audit?limit=200')
      setEntries(data.entries)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <section className="card admin-section-card">
      <div className="panel-head">
        <div>
          <p className="section-eyebrow">ADMIN AUDIT</p>
          <h2>操作审计</h2>
        </div>
        <button className="mini-btn" type="button" onClick={() => void load()}>刷新</button>
      </div>
      {loading ? (
        <div className="admin-loading" role="status">正在读取审计记录…</div>
      ) : entries.length === 0 ? (
        <p className="muted">暂无审计记录。</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">管理员</th>
                <th scope="col">动作</th>
                <th scope="col">资源</th>
                <th scope="col">请求 / IP</th>
                <th scope="col">变更</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.created_at).toLocaleString('zh-CN')}</td>
                  <td>{entry.actor_name}</td>
                  <td><code>{entry.action}</code></td>
                  <td>{entry.resource_type}{entry.resource_id ? ` #${entry.resource_id}` : ''}</td>
                  <td><code>{entry.request_id || '—'}</code><small>{entry.ip}</small></td>
                  <td>
                    <details>
                      <summary>查看</summary>
                      <pre>{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
