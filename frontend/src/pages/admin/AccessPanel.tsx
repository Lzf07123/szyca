import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import ConfirmDialog from '../../components/ConfirmDialog'

interface Account {
  id: number
  username: string
  role: 'owner' | 'content_editor' | 'event_operator' | 'data_viewer'
  disabled: boolean
  created_at: string
}

const roles: Array<{ value: Account['role']; label: string; description: string }> = [
  { value: 'content_editor', label: '内容编辑', description: '站点内容与媒体，不可操作答题或抽奖' },
  { value: 'event_operator', label: '活动运营', description: '答题控制与抽奖配置，不可发布站点' },
  { value: 'data_viewer', label: '数据查看', description: '只读题库、成绩与审计' },
  { value: 'owner', label: '所有者', description: '全部权限与管理员管理' },
]

export default function AccessPanel({ onMessage }: { onMessage: (message: string, error?: boolean) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Account['role']>('content_editor')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [pendingDisable, setPendingDisable] = useState<Account | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await api<{ accounts: Account[] }>('/api/admin/accounts')
      setAccounts(data.accounts)
    } catch (cause) {
      const message = (cause as Error).message || '管理员列表读取失败'
      setLoadError(message)
      onMessage(message, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const createAccount = async () => {
    setBusy(true)
    try {
      await api('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ username, password, role }),
      })
      setUsername('')
      setPassword('')
      await load()
      onMessage('管理员账号已创建')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const toggleAccount = async (account: Account) => {
    try {
      await api(`/api/admin/accounts/${account.id}/disabled`, {
        method: 'POST',
        body: JSON.stringify({ disabled: !account.disabled }),
      })
      await load()
      onMessage(account.disabled ? '账号已启用' : '账号已停用')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const requestToggleAccount = (account: Account) => {
    if (!account.disabled) {
      setPendingDisable(account)
      return
    }
    void toggleAccount(account)
  }

  return (
    <div className="admin-stack">
      <section className="card admin-section-card">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">TEAM ACCESS</p>
            <h2>管理员账号</h2>
          </div>
        </div>
        {loadError ? (
          <div className="admin-inline-error">
            <p>{loadError}</p>
            <button className="mini-btn" type="button" onClick={() => void load()}>重新读取</button>
          </div>
        ) : loading ? (
          <div className="admin-loading" role="status">正在读取管理员列表…</div>
        ) : (
          <div className="account-list">
            {accounts.map((account) => (
              <div className="account-row" key={account.id}>
                <span>
                  <strong>{account.username}</strong>
                  <small>{roles.find((item) => item.value === account.role)?.label ?? account.role}</small>
                </span>
                <span className={`status-chip${account.disabled ? ' off' : ''}`}>
                  {account.disabled ? '已停用' : '启用中'}
                </span>
                <button className="mini-btn" type="button" onClick={() => requestToggleAccount(account)}>
                  {account.disabled ? '启用' : '停用'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card admin-section-card">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">NEW ADMIN</p>
            <h2>新增管理员</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            用户名
            <input
              value={username}
              autoComplete="off"
              minLength={3}
              maxLength={32}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            初始密码
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field">
            角色
            <select value={role} onChange={(event) => setRole(event.target.value as Account['role'])}>
              {roles.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">{roles.find((item) => item.value === role)?.description}</p>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || username.length < 3 || password.length < 8}
          onClick={() => void createAccount()}
        >
          {busy ? '创建中…' : '创建账号'}
        </button>
      </section>
      {pendingDisable && (
        <ConfirmDialog
          title={`停用管理员 ${pendingDisable.username}？`}
          message="该账号的现有后台会话会立即失效，并将无法继续登录。"
          details={[
            '账号数据与审计记录会保留',
            '后续可重新启用以恢复登录权限',
          ]}
          confirmLabel="确认停用"
          tone="danger"
          onCancel={() => setPendingDisable(null)}
          onConfirm={() => {
            const account = pendingDisable
            setPendingDisable(null)
            void toggleAccount(account)
          }}
        />
      )}
    </div>
  )
}
