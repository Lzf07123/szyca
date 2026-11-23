import { useEffect, useState } from 'react'
import { api } from '@core/api/client'
import type { SiteFeature } from '@core/api/site'
import type { AdminPanelProps } from '@core/modules/contract'
import AdminPersonalLottery from './AdminPersonalLottery'
import NumberDrawAdmin from './NumberDrawAdmin'

interface NumberModes {
  screen_enabled: boolean
  personal_enabled: boolean
  updated_at: string
}

type LotteryMode = 'number' | 'personal'

export default function AdminLottery({ context }: AdminPanelProps) {
  const [feature, setFeature] = useState<SiteFeature | null>(null)
  const [modes, setModes] = useState<NumberModes | null>(null)
  const [modeTab, setModeTab] = useState<LotteryMode>('number')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [featureData, modeData] = await Promise.all([
        api<{ features: SiteFeature[] }>('/api/admin/platform/features'),
        api<{ modes: NumberModes }>('/api/admin/lottery/modes'),
      ])
      setFeature(featureData.features.find((item) => item.key === 'lottery') ?? null)
      setModes(modeData.modes)
    } catch (cause) {
      const message = (cause as Error).message || '抽奖控制台读取失败'
      setError(message)
      context.notify(message, true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggleGlobal = async () => {
    if (!feature) return
    setBusy(true)
    try {
      await api('/api/admin/platform/features', {
        method: 'PUT',
        body: JSON.stringify({
          features: [{ ...feature, enabled: !feature.enabled }],
        }),
      })
      await Promise.all([load(), context.reloadSite()])
      context.notify(!feature.enabled ? '抽奖模块总开关已开启' : '抽奖模块总开关已关闭')
    } catch (cause) {
      context.notify((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const saveModes = async (patch: Partial<Pick<NumberModes, 'screen_enabled' | 'personal_enabled'>>) => {
    if (!modes) return
    const next = { ...modes, ...patch }
    setBusy(true)
    try {
      const data = await api<{ modes: NumberModes }>('/api/admin/lottery/modes', {
        method: 'PUT',
        body: JSON.stringify({
          screen_enabled: next.screen_enabled,
          personal_enabled: next.personal_enabled,
        }),
      })
      setModes(data.modes)
      context.notify(
        patch.screen_enabled !== undefined
          ? `号码开奖大屏已${data.modes.screen_enabled ? '开启' : '关闭'}`
          : `个人抽取已${data.modes.personal_enabled ? '开启' : '关闭'}`,
      )
    } catch (cause) {
      context.notify((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="admin-loading" role="status">正在读取抽奖控制台…</div>
  }

  if (error || !feature || !modes) {
    return (
      <section className="card admin-section-card admin-page-error">
        <p className="section-eyebrow">LOTTERY CONSOLE UNAVAILABLE</p>
        <h2>抽奖控制台暂时无法读取</h2>
        <p className="error">{error || '抽奖模块配置缺失'}</p>
        <button className="btn btn-primary" type="button" onClick={() => void load()}>
          重新加载
        </button>
      </section>
    )
  }

  return (
    <div className="admin-stack lottery-console">
      <section className="card admin-section-card lottery-master">
        <div className="lottery-global-head">
          <div>
            <p className="section-eyebrow">LOTTERY CONTROL</p>
            <h2>抽奖模块</h2>
            <p className="muted">总开关控制整个模块的导航、路由和接口；下方两个模式可分别决定号码大屏与个人抽取是否公开可用。</p>
          </div>
          <button
            className={`switch-large${feature.enabled ? ' on' : ''}`}
            type="button"
            aria-pressed={feature.enabled}
            disabled={busy}
            onClick={() => void toggleGlobal()}
          >
            <span aria-hidden="true" />
            {feature.enabled ? '模块公开入口已开启' : '模块公开入口已关闭'}
          </button>
        </div>
        <div className="lottery-mode-grid">
          <label className={`lottery-mode-card${modes.screen_enabled ? ' on' : ''}`}>
            <span>
              <strong>号码开奖大屏</strong>
              <small>/lottery · 只读大屏，由后台逐级触发</small>
            </span>
            <input
              type="checkbox"
              checked={modes.screen_enabled}
              disabled={busy}
              onChange={(event) => void saveModes({ screen_enabled: event.target.checked })}
            />
          </label>
          <label className={`lottery-mode-card${modes.personal_enabled ? ' on' : ''}`}>
            <span>
              <strong>个人抽取</strong>
              <small>/lottery/participate · 答题后由参与者操作</small>
            </span>
            <input
              type="checkbox"
              checked={modes.personal_enabled}
              disabled={busy}
              onChange={(event) => void saveModes({ personal_enabled: event.target.checked })}
            />
          </label>
        </div>
      </section>

      <div className="lottery-mode-tabs" role="group" aria-label="抽奖模式">
        <button
          type="button"
          aria-pressed={modeTab === 'number'}
          className={modeTab === 'number' ? 'active' : ''}
          onClick={() => setModeTab('number')}
        >
          号码开奖
          <small>现场大屏</small>
        </button>
        <button
          type="button"
          aria-pressed={modeTab === 'personal'}
          className={modeTab === 'personal' ? 'active' : ''}
          onClick={() => setModeTab('personal')}
        >
          个人抽奖
          <small>答题后抽取</small>
        </button>
      </div>

      <div>
        {modeTab === 'number' ? (
          <NumberDrawAdmin onMessage={context.notify} />
        ) : (
          <AdminPersonalLottery onMessage={context.notify} />
        )}
      </div>
    </div>
  )
}
