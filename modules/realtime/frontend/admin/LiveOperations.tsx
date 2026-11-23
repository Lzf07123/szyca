import { useEffect, useState } from 'react'
import { api } from '@core/api/client'

type QuizState = 'start' | 'stop'

export default function LiveOperations({
  onMessage,
  onStateChange,
}: {
  onMessage: (message: string, error?: boolean) => void
  onStateChange?: (state: QuizState) => void
}) {
  const [state, setState] = useState<QuizState>('stop')
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [announcing, setAnnouncing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const data = await api<{ quiz_state: string }>('/api/config')
        if (!cancelled) {
          const next: QuizState = data.quiz_state === 'start' ? 'start' : 'stop'
          setState(next)
          onStateChange?.(next)
        }
      } catch {
        // Keep the last known state while the control channel is unavailable.
      }
    }
    void sync()
    const timer = window.setInterval(sync, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [onStateChange])

  const switchState = async (next: QuizState) => {
    if (busy) return
    if (next === 'stop' && !window.confirm('结束答题后，所有尚未提交的答案都将被拒绝。确定现在结束吗？')) return
    setBusy(true)
    try {
      await api('/api/admin/quiz-state', {
        method: 'POST',
        body: JSON.stringify({ state: next }),
      })
      setState(next)
      onStateChange?.(next)
      onMessage(next === 'start' ? '答题已开始，参与者可进入答题' : '答题已结束，未提交答案已停止接收')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const broadcast = async () => {
    const content = announcement.trim()
    if (!content || announcing) return
    setAnnouncing(true)
    try {
      await api('/api/admin/announce', {
        method: 'POST',
        body: JSON.stringify({ content, type: 'info' }),
      })
      setAnnouncement('')
      onMessage('公告已广播到答题页与现场大屏')
    } catch (cause) {
      onMessage((cause as Error).message, true)
    } finally {
      setAnnouncing(false)
    }
  }

  return (
    <>
      <div className="admin-panel">
        <h3>答题控制</h3>
        <p className="muted" role="status" aria-live="polite">
          当前状态：
          <b className={state === 'start' ? 'state-live' : 'state-idle'}>
            {state === 'start' ? '答题进行中' : '答题未开始'}
          </b>
        </p>
        <button className="btn btn-accent" type="button" disabled={state === 'start' || busy} onClick={() => void switchState('start')}>
          {busy ? '处理中…' : '开始答题'}
        </button>
        <button className="btn btn-danger-outline" type="button" disabled={state === 'stop' || busy} onClick={() => void switchState('stop')}>
          结束答题
        </button>
      </div>
      <div className="admin-panel">
        <h3>特效</h3>
        <button
          className="btn"
          type="button"
          onClick={() => {
            void api('/api/admin/effect', {
              method: 'POST',
              body: JSON.stringify({ kind: 'confetti' }),
            }).then(() => onMessage('已触发彩蛋特效')).catch((cause) => onMessage((cause as Error).message, true))
          }}
        >
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
        <button className="btn" type="button" disabled={!announcement.trim() || announcing} onClick={() => void broadcast()}>
          {announcing ? '正在广播…' : '广播公告'}
        </button>
      </div>
    </>
  )
}
