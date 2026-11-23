import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, clearToken, getToken } from '../api/client'
import PageIntro from '../components/PageIntro'
import { usePageMeta } from '../components/PageMeta'

interface Me {
  user_id: number
  nickname: string
  correct: number
  answered: number
  elapsed_ms: number
  score: number
  rank: number
  total: number
}

interface Entry {
  user_id: string
  nickname: string
  correct: number
  elapsed_ms: number
  score: number
}

export default function Result() {
  usePageMeta('我的成绩 · 计算机协会', '查看最佳答题成绩、答题表现与实时排名。')
  const nav = useNavigate()
  const [me, setMe] = useState<Me | null>(null)
  const [top, setTop] = useState<Entry[]>([])
  const [status, setStatus] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!getToken()) {
      setMe(null)
      setTop([])
      setError('')
      setStatus('empty')
      return
    }
    if (!quiet) {
      setStatus((current) => (current === 'ready' ? current : 'loading'))
      setError('')
    }
    try {
      const [meResult, rankResult] = await Promise.allSettled([
        api<Me>('/api/me'),
        api<{ entries: Entry[] }>('/api/rank?top=10'),
      ])
      if (meResult.status === 'rejected') {
        throw meResult.reason
      }
      setMe(meResult.value)
      if (rankResult.status === 'fulfilled') {
        setTop(rankResult.value.entries)
        setError('')
      } else {
        setTop([])
        setError(`排行榜暂时未更新：${(rankResult.reason as Error).message}`)
      }
      setUpdatedAt(new Date())
      setStatus('ready')
    } catch (cause) {
      const failure = cause as Error & { status?: number }
      if (failure.status === 401) {
        clearToken()
        setMe(null)
        setTop([])
        setStatus('empty')
        return
      }
      setError(failure.message || '成绩读取失败')
      setStatus((current) => (current === 'ready' ? current : 'error'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (status !== 'ready') return
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load, status])

  function fmt(ms: number) {
    const s = Math.round(ms / 1000)
    return `${Math.floor(s / 60)}分${s % 60}秒`
  }

  if (status === 'loading') {
    return (
      <>
        <PageIntro
          eyebrow="RESULT / 我的成绩"
          title="个人成绩"
          description="正在同步你的最佳成绩与实时排名。"
        />
        <section className="card center result-state" role="status" aria-live="polite">
          <span className="loading-mark" aria-hidden="true" />
          <p className="muted">正在读取答题记录与排行榜…</p>
        </section>
      </>
    )
  }

  if (status === 'error') {
    return (
      <>
        <PageIntro
          eyebrow="RESULT / 我的成绩"
          title="个人成绩"
          description="成绩服务暂时没有响应，可以重试或先查看公开榜单。"
        />
        <section className="card center result-state">
          <h2>成绩暂时无法加载</h2>
          <p className="error" role="alert">{error}</p>
          <div className="result-actions">
            <button className="btn btn-primary" type="button" onClick={() => void load()}>
              重新加载
            </button>
            <Link className="btn" to="/screen">查看排行榜</Link>
          </div>
        </section>
      </>
    )
  }

  if (status === 'empty' || !me) {
    return (
      <>
        <PageIntro
          eyebrow="RESULT / 我的成绩"
          title="个人成绩"
          description="完成答题后，在这里查看最佳成绩与实时排名。"
        />
        <section className="card center result-state">
          <h2>暂无答题记录</h2>
          <p className="muted">当前浏览器还没有绑定答题身份，完成一轮答题后即可查看成绩。</p>
          <div className="result-actions">
            <button className="btn btn-primary" type="button" onClick={() => nav('/quiz')}>
              去答题
            </button>
            <Link className="btn" to="/screen">查看排行榜</Link>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <PageIntro
        eyebrow="RESULT / 我的成绩"
        title="个人成绩"
        description="最佳成绩、正确题数与实时名次已同步到现场榜单。"
      />
      <div className="result-toolbar">
        <span className="result-sync" role="status" aria-live="polite">
          {error ? `排名同步失败：${error}` : `排名更新于 ${updatedAt?.toLocaleTimeString('zh-CN', { hour12: false }) || '刚刚'}`}
        </span>
        <div className="result-actions">
          <button className="mini-btn" type="button" onClick={() => void load()}>刷新排名</button>
          <Link className="mini-btn" to="/screen">打开大屏</Link>
        </div>
      </div>
      <section className="result-wrap">
        <div className="card center score-card">
          <h2>{me.nickname}</h2>
          <p className="big-score" aria-label={`最佳成绩 ${me.score} 分`}>{me.score}</p>
          <p className="muted">
            最佳成绩：答对 {me.correct} / {me.answered} 题 · 用时 {fmt(me.elapsed_ms)}
          </p>
          <p className="rank-line">
            当前排名 <b>{me.rank > 0 ? `第 ${me.rank} 名` : '未上榜'}</b> / 共 {me.total} 个答题身份
          </p>
          <button className="btn" type="button" onClick={() => nav('/quiz')}>
            再来一轮（保留最佳成绩）
          </button>
        </div>

        <div className="card">
          <h3>实时排行榜 TOP 10</h3>
          <ol className="rank-list">
            {top.map((e, i) => (
              <li key={e.user_id} className={e.user_id === String(me.user_id) ? 'self' : ''}>
                <span className={`rank-no no${i + 1}`}>{i + 1}</span>
                <span className="rank-name" title={e.nickname}>{e.nickname}</span>
                <span className="rank-detail">
                  {e.score} 分 · {e.correct} 题 · {fmt(e.elapsed_ms)}
                </span>
              </li>
            ))}
            {top.length === 0 && <li className="muted">暂无数据</li>}
          </ol>
        </div>
      </section>
    </>
  )
}
