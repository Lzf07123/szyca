import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, randomID } from '@core/api/client'
import ConfirmDialog from '@core/components/ConfirmDialog'

interface NumberEvent {
  id: number
  name: string
  status: 'draft' | 'live' | 'archived'
  range_start: string
  range_end: string
  number_width: number
  revision: number
  completed: boolean
  published_at?: string
  archived_at?: string
  created_at: string
  updated_at: string
}

interface NumberEventSummary extends NumberEvent {
  level_count: number
  planned_winners: number
  drawn_levels: number
  drawn_winners: number
}

interface NumberLevel {
  id: number
  name: string
  winner_count: number
  sort: number
  state: 'pending' | 'revealed'
  drawn_at?: string
  operator?: string
  winners: string[]
}

interface LevelForm {
  clientKey: string
  name: string
  winner_count: number
}

interface EventForm {
  id: number
  name: string
  range_start: string
  range_end: string
  number_width: number
  levels: LevelForm[]
}

interface ConfirmRequest {
  title: string
  message: ReactNode
  details?: ReactNode[]
  confirmLabel: string
  tone?: 'primary' | 'danger'
  action: () => Promise<void>
}

const blankEvent: EventForm = {
  id: 0,
  name: '',
  range_start: '1',
  range_end: '100',
  number_width: 3,
  levels: [{ clientKey: 'default-level', name: '一等奖', winner_count: 1 }],
}

const statusLabel: Record<NumberEvent['status'], string> = {
  draft: '草稿',
  live: '大屏上线',
  archived: '已归档',
}

function formFromDetail(event: NumberEvent, levels: NumberLevel[]): EventForm {
  return {
    id: event.id,
    name: event.name,
    range_start: event.range_start,
    range_end: event.range_end,
    number_width: event.number_width,
    levels: levels.map((level) => ({
      clientKey: `detail-${event.id}-${level.id}`,
      name: level.name,
      winner_count: level.winner_count,
    })),
  }
}

function eventRequest(form: EventForm) {
  return {
    id: form.id,
    name: form.name,
    range_start: form.range_start,
    range_end: form.range_end,
    number_width: form.number_width,
    levels: form.levels.map((level) => ({
      name: level.name,
      winner_count: level.winner_count,
    })),
  }
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

export default function NumberDrawAdmin({
  onMessage,
}: {
  onMessage: (message: string, error?: boolean) => void
}) {
  const [events, setEvents] = useState<NumberEventSummary[]>([])
  const [selectedID, setSelectedID] = useState(0)
  const [detail, setDetail] = useState<{ event: NumberEvent; levels: NumberLevel[] } | null>(null)
  const [form, setForm] = useState<EventForm>(blankEvent)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [switchingID, setSwitchingID] = useState(0)
  const [error, setError] = useState('')
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const detailSequence = useRef(0)
  const interactionLocked = busy || switchingID !== 0

  const nextLevel = useMemo(
    () => detail?.levels.find((level) => level.state === 'pending'),
    [detail],
  )
  const totalWinners = form.levels.reduce((total, level) => total + Math.max(0, level.winner_count), 0)
  const isDraft = selectedID === 0 || detail?.event.status === 'draft'
  const formValid = Boolean(
    form.name.trim() &&
    form.range_start.trim() &&
    form.range_end.trim() &&
    form.number_width >= 1 &&
    form.number_width <= 16 &&
    totalWinners >= 1 &&
    totalWinners <= 100 &&
    form.levels.length > 0 &&
    form.levels.every((level) => level.name.trim() && level.winner_count >= 1),
  )

  const loadEvents = async (preferredID = selectedID) => {
    const data = await api<{ events: NumberEventSummary[] }>('/api/admin/lottery/number-events')
    setEvents(data.events)
    return data.events.find((event) => event.id === preferredID)?.id
      ?? data.events.find((event) => event.status === 'live')?.id
      ?? data.events[0]?.id
      ?? 0
  }

  const loadDetail = async (eventID: number) => {
    const sequence = ++detailSequence.current
    if (!eventID) {
      setDetail(null)
      setForm(blankEvent)
      setSelectedID(0)
      setSwitchingID(0)
      return
    }
    setSwitchingID(eventID)
    try {
      const data = await api<{ event: NumberEvent; levels: NumberLevel[] }>(
        `/api/admin/lottery/number-events/${eventID}`,
      )
      if (sequence !== detailSequence.current) return
      setSelectedID(eventID)
      setDetail(data)
      setForm(formFromDetail(data.event, data.levels))
    } finally {
      if (sequence === detailSequence.current) setSwitchingID(0)
    }
  }

  const refresh = async (preferredID = selectedID) => {
    setError('')
    const nextID = await loadEvents(preferredID)
    await loadDetail(nextID)
  }

  useEffect(() => {
    let alive = true
    const initial = async () => {
      try {
        const nextID = await loadEvents(0)
        if (!alive) return
        await loadDetail(nextID)
      } catch (cause) {
        if (alive) {
          const message = (cause as Error).message || '号码抽奖场次读取失败'
          setError(message)
          onMessage(message, true)
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void initial()
    return () => {
      alive = false
    }
  }, [])

  const choose = async (eventID: number) => {
    if (eventID === selectedID && detail?.event.id === eventID) return
    setError('')
    try {
      await loadDetail(eventID)
    } catch (cause) {
      setDetail(null)
      setForm(blankEvent)
      setSelectedID(eventID)
      const message = (cause as Error).message || '场次读取失败'
      setError(message)
      onMessage(message, true)
    }
  }

  const startNew = () => {
    if (interactionLocked) return
    detailSequence.current += 1
    setSwitchingID(0)
    setSelectedID(0)
    setDetail(null)
    setForm({ ...blankEvent, levels: blankEvent.levels.map((level) => ({ ...level })) })
  }

  const saveDraft = async () => {
    if (interactionLocked) return
    setBusy(true)
    try {
      const data = await api<{ event: NumberEvent; levels: NumberLevel[] }>(
        '/api/admin/lottery/number-events',
        {
          method: 'POST',
          body: JSON.stringify(eventRequest(form)),
        },
      )
      await refresh(data.event.id)
      onMessage('号码抽奖草稿已保存')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (!detail || !formValid || interactionLocked) return
    setBusy(true)
    try {
      const saved = await api<{ event: NumberEvent; levels: NumberLevel[] }>(
        '/api/admin/lottery/number-events',
        {
          method: 'POST',
          body: JSON.stringify(eventRequest(form)),
        },
      )
      await api(`/api/admin/lottery/number-events/${saved.event.id}/publish`, { method: 'POST' })
      await refresh(saved.event.id)
      onMessage('号码抽奖场次已上线大屏')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    if (!detail || interactionLocked) return
    setBusy(true)
    try {
      await api(`/api/admin/lottery/number-events/${detail.event.id}/archive`, { method: 'POST' })
      await refresh(detail.event.id)
      onMessage('号码抽奖场次已归档')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const removeDraft = async () => {
    if (!detail || interactionLocked) return
    setBusy(true)
    try {
      await api(`/api/admin/lottery/number-events/${detail.event.id}`, { method: 'DELETE' })
      await refresh(0)
      onMessage('号码抽奖草稿已删除')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const drawNext = async () => {
    if (!detail || !nextLevel || interactionLocked) return
    setBusy(true)
    try {
      const data = await api<{ draw: { winners: string[]; level_name: string } }>(
        `/api/admin/lottery/number-events/${detail.event.id}/draw`,
        {
          method: 'POST',
          body: JSON.stringify({ level_id: nextLevel.id, request_id: randomID() }),
        },
      )
      await refresh(detail.event.id)
      onMessage(`${data.draw.level_name}已开奖，共 ${data.draw.winners.length} 个中奖号码`)
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const requestPublish = () => {
    if (!detail || !formValid || interactionLocked) return
    setConfirmRequest({
      title: `上线「${detail.event.name}」到大屏？`,
      message: '上线后号码范围、显示位宽和中奖等级将永久锁定。',
      details: [
        `号码范围：${form.range_start}–${form.range_end}`,
        `显示位宽：${form.number_width} 位`,
        `中奖配置：${form.levels.length} 个等级，共 ${totalWinners} 个号码`,
        '同一时间只能有一个场次处于上线状态',
      ],
      confirmLabel: '确认上线',
      action: publish,
    })
  }

  const requestArchive = () => {
    if (!detail || interactionLocked) return
    const pending = detail.levels.filter((level) => level.state === 'pending').length
    setConfirmRequest({
      title: '归档当前号码抽奖场次？',
      message: pending > 0
        ? `仍有 ${pending} 个等级未开奖。归档后大屏将回到待机。`
        : '归档后大屏将不再显示本场最终总榜。',
      details: [
        `开奖进度：${detail.levels.length - pending} / ${detail.levels.length} 级`,
        '已开奖结果不可撤回或重抽',
        '历史结果仍可在后台查看和导出',
      ],
      confirmLabel: '确认归档',
      tone: 'danger',
      action: archive,
    })
  }

  const requestRemoveDraft = () => {
    if (!detail || interactionLocked) return
    setConfirmRequest({
      title: `删除草稿「${detail.event.name}」？`,
      message: '草稿配置将从后台永久移除。',
      confirmLabel: '确认删除',
      tone: 'danger',
      action: removeDraft,
    })
  }

  const requestDraw = () => {
    if (!detail || !nextLevel || interactionLocked) return
    setConfirmRequest({
      title: `开始逐号抽取「${nextLevel.name}」？`,
      message: `本次将从 ${detail.event.range_start}–${detail.event.range_end} 中生成 ${nextLevel.winner_count} 个中奖号码，并在大屏逐号揭晓。`,
      details: [
        `中奖等级：${nextLevel.name}`,
        `中奖人数：${nextLevel.winner_count} 个号码`,
        '开奖结果提交后不可撤回或重抽',
      ],
      confirmLabel: '确认开奖',
      tone: 'danger',
      action: drawNext,
    })
  }

  const exportWinners = async () => {
    if (!detail || interactionLocked) return
    const response = await fetch(
      `/api/admin/lottery/number-events/${detail.event.id}/export`,
    )
    if (!response.ok) {
      onMessage('开奖结果导出失败', true)
      return
    }
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `lottery-number-${detail.event.id}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const updateLevel = (index: number, patch: Partial<LevelForm>) => {
    setForm((current) => ({
      ...current,
      levels: current.levels.map((level, levelIndex) => (
        levelIndex === index ? { ...level, ...patch } : level
      )),
    }))
  }

  const moveLevel = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= form.levels.length) return
    setForm((current) => {
      const levels = [...current.levels]
      const [level] = levels.splice(index, 1)
      levels.splice(target, 0, level)
      return { ...current, levels }
    })
  }

  const addLevel = () => {
    if (form.levels.length >= 20 || totalWinners >= 100) return
    setForm((current) => ({
      ...current,
      levels: [...current.levels, {
        clientKey: randomID(),
        name: '',
        winner_count: 1,
      }],
    }))
  }

  const removeLevel = (index: number) => {
    if (form.levels.length <= 1) return
    setForm((current) => ({
      ...current,
      levels: current.levels.filter((_, levelIndex) => levelIndex !== index),
    }))
  }

  if (loading) {
    return <div className="admin-loading" role="status">正在读取号码抽奖场次…</div>
  }

  return (
    <div className="admin-stack number-admin">
      {error && (
        <section className="card admin-section-card admin-page-error">
          <p className="section-eyebrow">NUMBER LOTTERY UNAVAILABLE</p>
          <h2>号码抽奖场次读取失败</h2>
          <p className="error">{error}</p>
          <button className="btn btn-primary" type="button" onClick={() => void refresh(selectedID)}>
            重新加载
          </button>
        </section>
      )}

      <section className="card admin-section-card number-overview">
        <div className="panel-head">
          <div>
            <p className="section-eyebrow">NUMBER DRAW OPERATIONS</p>
            <h2>号码开奖大屏</h2>
          </div>
          <div className="field-actions">
            <a className="mini-btn" href="/lottery" target="_blank" rel="noreferrer">打开大屏 ↗</a>
            <button className="mini-btn" type="button" onClick={startNew} disabled={interactionLocked}>新建场次</button>
          </div>
        </div>
        <p className="muted number-overview-copy">
          号码与用户身份解耦。上线后配置锁定，只能按顺序逐级开奖；同一时间最多一个场次在大屏展示。
        </p>
        <div className="number-event-list">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              aria-pressed={event.id === selectedID}
              aria-busy={event.id === switchingID}
              disabled={interactionLocked}
              className={[
                'number-event-item',
                event.id === selectedID ? 'selected' : '',
                event.id === switchingID ? 'loading' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => void choose(event.id)}
            >
              <span>
                <strong>{event.name}</strong>
                <small>#{event.id} · {event.range_start}–{event.range_end}</small>
              </span>
              <span>
                <em className={`status-chip ${event.status}`}>{statusLabel[event.status]}</em>
                <small>
                  {event.id === switchingID
                    ? '正在载入场次…'
                    : `${event.drawn_winners}/${event.planned_winners} 个号码 · ${event.drawn_levels}/${event.level_count} 级`}
                </small>
              </span>
            </button>
          ))}
          {events.length === 0 && <p className="muted">还没有号码抽奖场次，先保存一个草稿。</p>}
        </div>
      </section>

      {isDraft ? (
        <section className="card admin-section-card number-editor">
          <div className="panel-head">
            <div>
              <p className="section-eyebrow">DRAW CONFIGURATION</p>
              <h2>{form.id ? '编辑草稿' : '新建号码场次'}</h2>
            </div>
            <span className="read-only-note">上线后配置永久锁定</span>
          </div>
          <div className="form-grid">
            <label className="field number-wide-field">
              场次名称
              <input
                value={form.name}
                maxLength={80}
                placeholder="例如：2026 招新现场抽奖"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="field">
              起始号码
              <input
                inputMode="numeric"
                value={form.range_start}
                onChange={(event) => setForm({ ...form, range_start: event.target.value })}
              />
            </label>
            <label className="field">
              结束号码
              <input
                inputMode="numeric"
                value={form.range_end}
                onChange={(event) => setForm({ ...form, range_end: event.target.value })}
              />
            </label>
            <label className="field">
              显示位宽
              <input
                type="number"
                min={1}
                max={16}
                value={form.number_width}
                onChange={(event) => setForm({ ...form, number_width: Number(event.target.value) })}
              />
            </label>
          </div>

          <div className="number-level-head">
            <div>
              <h3>中奖等级</h3>
              <p>从上到下依次开奖；单场总中奖人数不超过 100。</p>
            </div>
            <span className={totalWinners > 100 ? 'error' : 'muted'}>
              已配置 {totalWinners} / 100 人
            </span>
          </div>
          <div className="number-level-list">
            {form.levels.map((level, index) => (
              <div className="number-level-row" key={level.clientKey}>
                <span className="number-level-order">{String(index + 1).padStart(2, '0')}</span>
                <label>
                  <span>等级名称</span>
                  <input
                    value={level.name}
                    maxLength={40}
                    placeholder="一等奖"
                    onChange={(event) => updateLevel(index, { name: event.target.value })}
                  />
                </label>
                <label>
                  <span>中奖人数</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={level.winner_count}
                    onChange={(event) => updateLevel(index, {
                      winner_count: Number(event.target.value),
                    })}
                  />
                </label>
                <div className="number-level-actions">
                  <button className="mini-btn" type="button" disabled={index === 0} onClick={() => moveLevel(index, -1)}>上移</button>
                  <button className="mini-btn" type="button" disabled={index === form.levels.length - 1} onClick={() => moveLevel(index, 1)}>下移</button>
                  <button className="mini-btn danger" type="button" disabled={form.levels.length === 1} onClick={() => removeLevel(index)}>删除</button>
                </div>
              </div>
            ))}
          </div>
          <div className="field-actions number-editor-actions">
            <button
              className="btn"
              type="button"
              disabled={interactionLocked || form.levels.length >= 20 || totalWinners >= 100}
              onClick={addLevel}
            >
              添加等级
            </button>
            <button className="btn btn-primary" type="button" disabled={interactionLocked || !formValid} onClick={() => void saveDraft()}>
              {busy ? '保存中…' : switchingID ? '载入中…' : '保存草稿'}
            </button>
            {detail && (
              <button className="btn" type="button" disabled={interactionLocked || !formValid} onClick={requestPublish}>
                上线大屏
              </button>
            )}
            {detail && (
              <button className="btn btn-danger-outline" type="button" disabled={interactionLocked} onClick={requestRemoveDraft}>
                删除草稿
              </button>
            )}
          </div>
        </section>
      ) : detail ? (
        <>
          <section className="card admin-section-card number-live-panel">
            <div className="panel-head">
              <div>
                <p className="section-eyebrow">{detail.event.status === 'live' ? 'ON AIR' : 'ARCHIVED'}</p>
                <h2>{detail.event.name}</h2>
              </div>
              <span className={`status-chip ${detail.event.status}`}>{statusLabel[detail.event.status]}</span>
            </div>
            <div className="number-live-grid">
              <div><span>号码范围</span><strong>{detail.event.range_start}–{detail.event.range_end}</strong></div>
              <div><span>显示位宽</span><strong>{detail.event.number_width} 位</strong></div>
              <div><span>开奖进度</span><strong>{detail.levels.filter((level) => level.state === 'revealed').length}/{detail.levels.length} 级</strong></div>
              <div><span>上线时间</span><strong>{formatTime(detail.event.published_at) || '-'}</strong></div>
            </div>
            {detail.event.status === 'live' && (
              <div className="number-draw-action">
                <div>
                  <span>下一轮</span>
                  <strong>{nextLevel ? `${nextLevel.name} · ${nextLevel.winner_count} 人` : '全部等级已开奖'}</strong>
                  <p>{nextLevel ? '结果提交后在大屏逐号揭晓并永久保留。' : '可继续保留最终总榜，或归档场次。'}</p>
                </div>
                <button
                  className="btn btn-primary number-draw-button"
                  type="button"
                  disabled={interactionLocked || !nextLevel}
                  onClick={requestDraw}
                >
                  {busy ? '开奖处理中…' : nextLevel ? `开始逐号抽取 ${nextLevel.name}` : '本场已开完'}
                </button>
              </div>
            )}
            <div className="field-actions">
              <button className="mini-btn" type="button" disabled={interactionLocked} onClick={() => void exportWinners()}>导出 CSV</button>
              {detail.event.status === 'live' && (
                <button className="btn btn-danger-outline" type="button" disabled={interactionLocked} onClick={requestArchive}>
                  归档场次
                </button>
              )}
            </div>
          </section>

          <section className="card admin-section-card">
            <div className="panel-head">
              <div>
                <p className="section-eyebrow">RESULT LEDGER</p>
                <h2>{detail.event.status === 'archived' ? '历史开奖结果' : '实时开奖结果'}</h2>
              </div>
              <span className="muted">共 {detail.levels.reduce((total, level) => total + level.winners.length, 0)} 个中奖号码</span>
            </div>
            <div className="number-result-list">
              {detail.levels.map((level) => (
                <section className={`number-result-level${level.state === 'revealed' ? ' revealed' : ''}`} key={level.id}>
                  <header>
                    <div>
                      <span>{String(level.sort / 10).padStart(2, '0')}</span>
                      <h3>{level.name}</h3>
                    </div>
                    <small>
                      {level.state === 'revealed'
                        ? `${level.winners.length} 人 · ${formatTime(level.drawn_at)}${level.operator ? ` · ${level.operator}` : ''}`
                        : `${level.winner_count} 人待开奖`}
                    </small>
                  </header>
                  {level.state === 'revealed' ? (
                    <ol>{level.winners.map((winner) => <li key={winner}>{winner}</li>)}</ol>
                  ) : (
                    <p className="number-pending-copy">等待后台按顺序开奖</p>
                  )}
                </section>
              ))}
            </div>
          </section>
        </>
      ) : null}
      {confirmRequest && (
        <ConfirmDialog
          title={confirmRequest.title}
          message={confirmRequest.message}
          details={confirmRequest.details}
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
    </div>
  )
}
