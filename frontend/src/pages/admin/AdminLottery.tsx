import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { SiteFeature } from '../../api/site'

interface Campaign {
  id: number
  name: string
  status: 'draft' | 'active' | 'paused' | 'ended'
  starts_at?: string
  ends_at?: string
  eligibility: 'completed_round' | 'min_score'
  eligibility_min_score: number
  max_draws_per_user: number
  no_win_weight: number
  enabled: boolean
  prizes: Prize[]
}

interface Prize {
  id: number
  name: string
  total: number
  remaining: number
  won: number
  claimed: number
  weight: number
  enabled: boolean
  sort: number
}

interface Draw {
  id: number
  campaign_id: number
  campaign: string
  nickname: string
  user_id: number
  prize: string
  status: 'won' | 'claimed' | 'no_win'
  request_id: string
  created_at: string
  claimed_at?: string
}

interface CampaignForm {
  id: number
  name: string
  status: Campaign['status']
  starts_at: string
  ends_at: string
  eligibility: Campaign['eligibility']
  eligibility_min_score: number
  no_win_weight: number
  enabled: boolean
}

const blankCampaign: CampaignForm = {
  id: 0,
  name: '招新现场抽奖',
  status: 'draft',
  starts_at: '',
  ends_at: '',
  eligibility: 'completed_round',
  eligibility_min_score: 0,
  no_win_weight: 100,
  enabled: true,
}

function localDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function campaignToForm(campaign: Campaign): CampaignForm {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    starts_at: localDateTime(campaign.starts_at),
    ends_at: localDateTime(campaign.ends_at),
    eligibility: campaign.eligibility,
    eligibility_min_score: campaign.eligibility_min_score,
    no_win_weight: campaign.no_win_weight,
    enabled: campaign.enabled,
  }
}

export default function AdminLottery({
  onMessage,
  onSiteChanged,
}: {
  onMessage: (message: string, error?: boolean) => void
  onSiteChanged: () => Promise<void>
}) {
  const [feature, setFeature] = useState<SiteFeature | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedID, setSelectedID] = useState(0)
  const [form, setForm] = useState<CampaignForm>(blankCampaign)
  const [draws, setDraws] = useState<Draw[]>([])
  const [busy, setBusy] = useState(false)
  const [newPrize, setNewPrize] = useState({ name: '', total: 10, remaining: 10, weight: 1 })
  const selected = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedID),
    [campaigns, selectedID],
  )

  const load = async (keepSelection = true) => {
    try {
      const [featureData, campaignData] = await Promise.all([
        api<{ features: SiteFeature[] }>('/api/admin/platform/features'),
        api<{ campaigns: Campaign[] }>('/api/admin/lottery/campaigns'),
      ])
      setFeature(featureData.features.find((item) => item.key === 'lottery') ?? null)
      setCampaigns(campaignData.campaigns)
      const preferred = keepSelection && campaignData.campaigns.some((item) => item.id === selectedID)
        ? selectedID
        : campaignData.campaigns[0]?.id ?? 0
      setSelectedID(preferred)
      const campaign = campaignData.campaigns.find((item) => item.id === preferred)
      setForm(campaign ? campaignToForm(campaign) : blankCampaign)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const loadDraws = async (campaignID = selectedID) => {
    try {
      const query = campaignID ? `?campaign_id=${campaignID}&limit=500` : '?limit=500'
      const data = await api<{ draws: Draw[] }>(`/api/admin/lottery/draws${query}`)
      setDraws(data.draws)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  useEffect(() => {
    void load(false)
  }, [])

  useEffect(() => {
    if (selectedID) void loadDraws(selectedID)
  }, [selectedID])

  const choose = (id: number) => {
    setSelectedID(id)
    const campaign = campaigns.find((item) => item.id === id)
    setForm(campaign ? campaignToForm(campaign) : blankCampaign)
  }

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
      await Promise.all([load(), onSiteChanged()])
      onMessage(!feature.enabled ? '抽奖总开关已开启' : '抽奖总开关已关闭')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const saveCampaign = async () => {
    setBusy(true)
    try {
      const data = await api<{ campaign: Campaign }>('/api/admin/lottery/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          id: form.id,
          name: form.name,
          status: form.status,
          starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
          ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
          eligibility: form.eligibility,
          eligibility_min_score: form.eligibility_min_score,
          no_win_weight: form.no_win_weight,
          enabled: form.enabled,
        }),
      })
      await load()
      setSelectedID(data.campaign.id)
      setForm(campaignToForm({ ...data.campaign, prizes: [] }))
      onMessage('抽奖活动配置已保存')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const updateStatus = async (status: Campaign['status']) => {
    if (!form.id) return
    setBusy(true)
    try {
      await api(`/api/admin/lottery/campaigns/${form.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      setForm((current) => ({ ...current, status }))
      await load()
      onMessage(`活动状态已切换为 ${status}`)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const addPrize = async () => {
    if (!form.id) return
    setBusy(true)
    try {
      await api(`/api/admin/lottery/campaigns/${form.id}/prizes`, {
        method: 'POST',
        body: JSON.stringify({
          ...newPrize,
          enabled: true,
          sort: selected?.prizes.length ? Math.max(...selected.prizes.map((item) => item.sort)) + 10 : 10,
        }),
      })
      setNewPrize({ name: '', total: 10, remaining: 10, weight: 1 })
      await load()
      onMessage('奖品已添加')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const savePrize = async (prize: Prize) => {
    if (!form.id) return
    try {
      await api(`/api/admin/lottery/campaigns/${form.id}/prizes`, {
        method: 'POST',
        body: JSON.stringify({
          id: prize.id,
          name: prize.name,
          total: prize.total,
          remaining: prize.remaining,
          weight: prize.weight,
          enabled: prize.enabled,
          sort: prize.sort,
        }),
      })
      await load()
      onMessage('奖品与库存已保存')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const deletePrize = async (prize: Prize) => {
    if (!window.confirm(`确定删除奖品「${prize.name}」？已有中奖记录时服务端会拒绝。`)) return
    try {
      await api(`/api/admin/lottery/campaigns/${form.id}/prizes/${prize.id}`, { method: 'DELETE' })
      await load()
      onMessage('奖品已删除')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const claim = async (draw: Draw) => {
    try {
      await api(`/api/admin/lottery/draws/${draw.id}/claim`, { method: 'POST' })
      await loadDraws()
      onMessage(`已核销：${draw.nickname} · ${draw.prize}`)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    }
  }

  const exportDraws = async () => {
    const query = form.id ? `?campaign_id=${form.id}` : ''
    const response = await fetch(`/api/admin/lottery/export${query}`)
    if (!response.ok) {
      onMessage('抽奖结果导出失败', true)
      return
    }
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `lottery-draws-${Date.now()}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  if (!feature) return <div className="admin-loading" role="status">正在读取抽奖配置…</div>

  return (
    <div className="admin-stack lottery-admin">
      <section className="card admin-section-card lottery-global">
        <div>
          <p className="section-eyebrow">GLOBAL SWITCH</p>
          <h2>抽奖总开关</h2>
          <p className="muted">关闭后公开入口、抽奖页和公开接口立即失效；后台配置仍保留。</p>
        </div>
        <button
          className={`switch-large${feature.enabled ? ' on' : ''}`}
          type="button"
          aria-pressed={feature.enabled}
          disabled={busy}
          onClick={() => void toggleGlobal()}
        >
          <span aria-hidden="true" />
          {feature.enabled ? '已开启' : '默认关闭'}
        </button>
      </section>

      <section className="card admin-section-card">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">CAMPAIGN</p>
            <h2>活动生命周期</h2>
          </div>
          <button className="mini-btn" type="button" onClick={() => choose(0)}>新建活动</button>
        </div>
        <label className="field">
          编辑活动
          <select value={form.id} onChange={(event) => choose(Number(event.target.value))}>
            <option value={0}>新建活动</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                #{campaign.id} {campaign.name} · {campaign.status}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            活动名称
            <input
              value={form.name}
              maxLength={80}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            状态
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as Campaign['status'] })}
            >
              <option value="draft">草稿</option>
              <option value="active">进行中</option>
              <option value="paused">暂停</option>
              <option value="ended">结束</option>
            </select>
          </label>
          <label className="field">
            开始时间
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
            />
          </label>
          <label className="field">
            结束时间
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
            />
          </label>
          <label className="field">
            参与资格
            <select
              value={form.eligibility}
              onChange={(event) => setForm({
                ...form,
                eligibility: event.target.value as Campaign['eligibility'],
              })}
            >
              <option value="completed_round">至少完成一轮答题</option>
              <option value="min_score">最佳成绩达到指定分数</option>
            </select>
          </label>
          <label className="field">
            {form.eligibility === 'min_score' ? '最低最佳成绩' : '保留字段（当前门槛为完成一轮）'}
            <input
              type="number"
              min={0}
              value={form.eligibility_min_score}
              disabled={form.eligibility !== 'min_score'}
              onChange={(event) => setForm({
                ...form,
                eligibility_min_score: Number(event.target.value),
              })}
            />
          </label>
          <label className="field">
            未中奖权重（概率配置仅后台可见）
            <input
              type="number"
              min={0}
              value={form.no_win_weight}
              onChange={(event) => setForm({ ...form, no_win_weight: Number(event.target.value) })}
            />
          </label>
          <label className="inline-check campaign-enabled">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            此活动允许公开
          </label>
        </div>
        <div className="field-actions">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void saveCampaign()}>
            {busy ? '保存中…' : '保存活动'}
          </button>
          {form.id > 0 && form.status !== 'paused' && (
            <button className="btn" type="button" onClick={() => void updateStatus('paused')}>暂停活动</button>
          )}
          {form.id > 0 && form.status !== 'active' && (
            <button className="btn btn-secondary" type="button" onClick={() => void updateStatus('active')}>恢复进行</button>
          )}
          {form.id > 0 && form.status !== 'ended' && (
            <button className="btn" type="button" onClick={() => void updateStatus('ended')}>结束活动</button>
          )}
        </div>
      </section>

      {form.id > 0 && (
        <section className="card admin-section-card">
          <div className="panel-head">
            <div>
              <p className="section-eyebrow">PRIZES & INVENTORY</p>
              <h2>奖品库存</h2>
            </div>
          </div>
          <div className="prize-list">
            {(selected?.prizes ?? []).map((prize) => (
              <PrizeEditor
                key={prize.id}
                prize={prize}
                onChange={(next) => setCampaigns((current) => current.map((campaign) => (
                  campaign.id === form.id
                    ? {
                      ...campaign,
                      prizes: campaign.prizes.map((item) => item.id === prize.id ? next : item),
                    }
                    : campaign
                )))}
                onSave={() => void savePrize(prize)}
                onDelete={() => void deletePrize(prize)}
              />
            ))}
            {(selected?.prizes.length ?? 0) === 0 && <p className="muted">还没有奖品。</p>}
          </div>
          <div className="form-grid prize-new">
            <label className="field">
              新奖品名称
              <input
                value={newPrize.name}
                onChange={(event) => setNewPrize({ ...newPrize, name: event.target.value })}
              />
            </label>
            <label className="field">
              总库存
              <input
                type="number"
                min={0}
                value={newPrize.total}
                onChange={(event) => {
                  const total = Number(event.target.value)
                  setNewPrize({ ...newPrize, total, remaining: total })
                }}
              />
            </label>
            <label className="field">
              权重
              <input
                type="number"
                min={1}
                value={newPrize.weight}
                onChange={(event) => setNewPrize({ ...newPrize, weight: Number(event.target.value) })}
              />
            </label>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || !newPrize.name.trim()}
              onClick={() => void addPrize()}
            >
              添加奖品
            </button>
          </div>
        </section>
      )}

      <section className="card admin-section-card">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">CLAIMS & RESULTS</p>
            <h2>抽奖记录与领取</h2>
          </div>
          <div className="field-actions">
            <button className="mini-btn" type="button" onClick={() => void loadDraws()}>刷新</button>
            <button className="mini-btn" type="button" onClick={() => void exportDraws()}>导出 CSV</button>
          </div>
        </div>
        <div className="draw-list">
          {draws.map((draw) => (
            <div className="draw-row" key={draw.id}>
              <span>
                <strong>{draw.nickname}</strong>
                <small>{new Date(draw.created_at).toLocaleString('zh-CN')}</small>
              </span>
              <span>{draw.status === 'no_win' ? '谢谢参与' : draw.prize}</span>
              <span className={`status-chip${draw.status === 'claimed' ? ' off' : ''}`}>
                {draw.status === 'won' ? '待领取' : draw.status === 'claimed' ? '已领取' : '未中奖'}
              </span>
              {draw.status === 'won' && (
                <button className="mini-btn" type="button" onClick={() => void claim(draw)}>
                  核销领取
                </button>
              )}
            </div>
          ))}
          {draws.length === 0 && <p className="muted">当前活动暂无抽奖记录。</p>}
        </div>
      </section>
    </div>
  )
}

function PrizeEditor({
  prize,
  onChange,
  onSave,
  onDelete,
}: {
  prize: Prize
  onChange: (prize: Prize) => void
  onSave: () => void
  onDelete: () => void
}) {
  return (
    <div className="prize-row">
      <label>
        <span>奖品</span>
        <input value={prize.name} onChange={(event) => onChange({ ...prize, name: event.target.value })} />
      </label>
      <label>
        <span>总库存</span>
        <input
          type="number"
          min={0}
          value={prize.total}
          onChange={(event) => onChange({ ...prize, total: Number(event.target.value) })}
        />
      </label>
      <label>
        <span>剩余</span>
        <input
          type="number"
          min={0}
          value={prize.remaining}
          onChange={(event) => onChange({ ...prize, remaining: Number(event.target.value) })}
        />
      </label>
      <label>
        <span>权重</span>
        <input
          type="number"
          min={1}
          value={prize.weight}
          onChange={(event) => onChange({ ...prize, weight: Number(event.target.value) })}
        />
      </label>
      <span className="prize-stats">已抽 {prize.won} · 已领 {prize.claimed}</span>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={prize.enabled}
          onChange={(event) => onChange({ ...prize, enabled: event.target.checked })}
        />
        启用
      </label>
      <button className="mini-btn" type="button" onClick={onSave}>保存</button>
      <button className="mini-btn danger" type="button" onClick={onDelete}>删除</button>
    </div>
  )
}
