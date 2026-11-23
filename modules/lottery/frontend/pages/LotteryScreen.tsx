import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@core/api/client'
import { useLogoURL, useSite } from '@core/api/site'
import BrandMark from '@core/components/BrandMark'
import PageMeta from '@core/components/PageMeta'
import ScrambleText from '@core/components/ScrambleText'
import { QuizSocket, wsURL } from '@core/ws/socket'

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
  updated_at: string
}

interface NumberLevel {
  id: number
  name: string
  winner_count: number
  sort: number
  state: 'pending' | 'revealed'
  drawn_at?: string
  winners: string[]
}

interface NumberBoard {
  enabled: boolean
  event: NumberEvent | null
  levels: NumberLevel[]
}

interface RevealSequence {
  levelID: number
  levelName: string
  winners: string[]
  index: number
}

const emptyBoard: NumberBoard = { enabled: true, event: null, levels: [] }

function usesReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function LotteryScreen() {
  const { site } = useSite()
  const logoURL = useLogoURL()
  const [board, setBoard] = useState<NumberBoard>(emptyBoard)
  const [loading, setLoading] = useState(true)
  const [syncError, setSyncError] = useState('')
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [revealSequence, setRevealSequence] = useState<RevealSequence | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const knownDraws = useRef<Set<number>>(new Set())
  const knownEventID = useRef<number | null>(null)
  const currentEventID = useRef<number | null>(null)
  const revisions = useRef<Map<number, number>>(new Map())
  const closedEvents = useRef<Set<number>>(new Set())
  const boardSequence = useRef(0)
  const initialized = useRef(false)
  const reducedMotion = useRef(false)

  const applyBoard = useCallback((next: NumberBoard) => {
    if (currentEventID.current && next.enabled && !next.event) {
      closedEvents.current.add(currentEventID.current)
    }
    if (next.event) {
      if (closedEvents.current.has(next.event.id)) return
      const seen = revisions.current.get(next.event.id) ?? -1
      if (next.event.revision < seen) return
      revisions.current.set(next.event.id, next.event.revision)
    }
    if (next.event) {
      currentEventID.current = next.event.id
    } else if (next.enabled) {
      currentEventID.current = null
    }
    setBoard(next)
    if (!next.event) {
      knownDraws.current = new Set()
      knownEventID.current = null
      initialized.current = false
      setRevealSequence(null)
      return
    }

    const drawn = next.levels.filter((level) => level.state === 'revealed')
    const drawnIDs = new Set(drawn.map((level) => level.id))
    if (!initialized.current || knownEventID.current !== next.event.id) {
      initialized.current = true
      knownEventID.current = next.event.id
      knownDraws.current = drawnIDs
      setRevealSequence(null)
      return
    }

    const fresh = drawn.filter((level) => !knownDraws.current.has(level.id))
    knownDraws.current = new Set([...knownDraws.current, ...drawnIDs])
    if (fresh.length === 0) return

    const latest = fresh[fresh.length - 1]
    if (reducedMotion.current) {
      setAnnouncement(`${latest.name}开奖完成，中奖号码：${latest.winners.join('、')}`)
      setRevealSequence(null)
      return
    }

    setRevealSequence({
      levelID: latest.id,
      levelName: latest.name,
      winners: latest.winners,
      index: 0,
    })
  }, [])

  useEffect(() => {
    reducedMotion.current = usesReducedMotion()
    let alive = true
    const sync = async () => {
      const sequence = ++boardSequence.current
      try {
        const next = await api<NumberBoard>('/api/lottery/board')
        if (alive && sequence === boardSequence.current) {
          applyBoard(next)
          setSyncError('')
        }
      } catch (cause) {
        if (alive && sequence === boardSequence.current) {
          setSyncError((cause as Error).message || '大屏状态读取失败')
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void sync()
    const poll = window.setInterval(() => void sync(), 5000)

    const socket = new QuizSocket(
      wsURL(),
      (message) => {
        if (message.type === 'lottery_board' && message.data) {
          boardSequence.current += 1
          applyBoard(message.data as NumberBoard)
          setSyncError('')
        }
      },
      (connected) => {
        setConnection(connected ? 'online' : 'offline')
        if (connected) void sync()
      },
    )
    socket.connect()
    return () => {
      alive = false
      window.clearInterval(poll)
      socket.close()
    }
  }, [applyBoard])

  useEffect(() => {
    if (!revealSequence) return
    const isLast = revealSequence.index >= revealSequence.winners.length - 1
    const timer = window.setTimeout(() => {
      if (!isLast) {
        setRevealSequence((current) => current
          ? { ...current, index: current.index + 1 }
          : null)
        return
      }
      setAnnouncement(
        `${revealSequence.levelName}开奖完成，中奖号码：${revealSequence.winners.join('、')}`,
      )
      setRevealSequence(null)
    }, isLast ? 2200 : 1700)
    return () => window.clearTimeout(timer)
  }, [revealSequence])

  const event = board.event
  const nextLevel = useMemo(
    () => board.levels.find((level) => level.state === 'pending'),
    [board.levels],
  )
  const latestRevealedID = useMemo(() => {
    const revealed = board.levels.filter((level) => level.state === 'revealed')
    return revealed.length > 0 ? revealed[revealed.length - 1].id : undefined
  }, [board.levels])
  const drawnCount = board.levels.reduce((total, level) => total + level.winners.length, 0)
  const displayedRange = event
    ? `${event.range_start.padStart(event.number_width, '0')}–${event.range_end.padStart(event.number_width, '0')}`
    : ''

  return (
    <>
      <PageMeta
        title={`现场抽奖 · ${site.brand.name}`}
        description="计算机协会现场号码抽奖实时大屏，中奖号码在大屏实时公布。"
      />
      <section className="lottery-screen" aria-labelledby="lottery-screen-title">
        <header className="lottery-screen-head">
          <div className="lottery-screen-brand">
            {logoURL ? <img src={logoURL} alt="" /> : <BrandMark variant="header" />}
            <div className="lottery-screen-brand-copy">
              <span>{site.brand.name}</span>
              <small>LIVE NUMBER DRAW</small>
            </div>
          </div>
          <div className="lottery-screen-masthead">
            <span>现场号码抽奖</span>
            <small>REAL-TIME DRAW</small>
          </div>
          <div className="lottery-screen-connection" data-state={connection}>
            <i aria-hidden="true" />
            {connection === 'online'
              ? '实时连接'
              : connection === 'offline'
                ? '自动重连中'
                : '连接中'}
          </div>
        </header>

        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        {syncError && (
          <div className="lottery-screen-alert" role="status">
            大屏状态同步中断，正在保留最后一次有效结果并自动恢复。
          </div>
        )}

        <div className="lottery-screen-main">
          {loading ? (
            <div className="lottery-screen-state" role="status">
              <span className="loading-mark" aria-hidden="true" />
              <h1 id="lottery-screen-title">正在连接现场开奖</h1>
            </div>
          ) : !board.enabled ? (
            <div className="lottery-screen-state">
              <p className="lottery-screen-kicker">SCREEN CLOSED</p>
              <h1 id="lottery-screen-title">号码抽奖大屏暂未开放</h1>
              <p>请留意现场通知，开放后将在此实时公布号码。</p>
            </div>
          ) : !event ? (
            <div className="lottery-screen-state standby">
              <div className="lottery-standby-orbit" aria-hidden="true" />
              <p className="lottery-screen-kicker"><ScrambleText text="STANDBY" /></p>
              <h1 id="lottery-screen-title">等待现场开奖</h1>
              <p>开奖号码与结果将在现场统一公布。</p>
              <div className="lottery-standby-facts">
                <span><b>LIVE</b>状态实时同步</span>
                <span><b>STEP</b>按等级依次揭晓</span>
                <span><b>FAIR</b>号码随机生成</span>
              </div>
            </div>
          ) : (
            <>
              <div className="lottery-screen-titlebar">
                <div>
                  <p className="lottery-screen-kicker">
                    {event.completed ? 'DRAW COMPLETE' : 'LIVE DRAW'}
                  </p>
                  <h1 id="lottery-screen-title">{event.name}</h1>
                </div>
                <div className="lottery-screen-summary">
                  <span>号码范围 <b>{displayedRange}</b></span>
                  <span>中奖号码 <b>{drawnCount}</b></span>
                  <span className={`lottery-screen-state-chip${event.completed ? ' complete' : ''}`}>
                    {event.completed ? '本场已开完' : nextLevel ? `下一轮 · ${nextLevel.name}` : '等待开奖'}
                  </span>
                </div>
              </div>

              {revealSequence && (
                <div
                  className="lottery-sequence-stage"
                  data-sequence-index={revealSequence.index}
                  aria-live="polite"
                >
                  <div className="lottery-sequence-head">
                    <span>{revealSequence.levelName}</span>
                    <small>
                      {revealSequence.index + 1} / {revealSequence.winners.length}
                    </small>
                  </div>
                  <strong aria-hidden="true">
                    <ScrambleText
                      text={revealSequence.winners[revealSequence.index]}
                      minLength={1}
                    />
                  </strong>
                  <p className="sr-only">
                    第 {revealSequence.index + 1} 个中奖号码：
                    {revealSequence.winners[revealSequence.index]}
                  </p>
                  <div className="lottery-sequence-dots" aria-hidden="true">
                    {revealSequence.winners.map((winner, index) => (
                      <i
                        key={winner}
                        className={index <= revealSequence.index ? 'revealed' : undefined}
                      />
                    ))}
                  </div>
                  {revealSequence.index > 0 && (
                    <div className="lottery-sequence-history" aria-hidden="true">
                      {revealSequence.winners.slice(0, revealSequence.index).map((winner) => (
                        <span key={winner}>{winner}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className={`lottery-result-board${board.levels.length > 2 ? ' dense' : ''}${revealSequence ? ' is-revealing' : ''}`}>
                {board.levels.map((level) => {
                  const hidden = revealSequence?.levelID === level.id
                  return (
                    <section
                      className={[
                        'lottery-result-level',
                        level.state === 'revealed' ? 'revealed' : 'pending',
                        level.id === latestRevealedID ? 'latest' : '',
                        hidden ? 'currently-rolling' : '',
                      ].filter(Boolean).join(' ')}
                      key={level.id}
                      aria-labelledby={`lottery-level-${level.id}`}
                    >
                      <header>
                        <div>
                          <span className="lottery-level-index">
                            {String(level.sort / 10).padStart(2, '0')}
                          </span>
                          <h2 id={`lottery-level-${level.id}`}>{level.name}</h2>
                        </div>
                        <span>{level.state === 'revealed' ? `${level.winners.length} 人中奖` : `${level.winner_count} 人待开`}</span>
                      </header>
                      {level.state === 'revealed' && !hidden ? (
                        <ol className="lottery-winner-grid">
                          {level.winners.map((winner, index) => (
                            <li key={winner}>
                              <span aria-hidden="true">
                                <ScrambleText text={winner} delay={index * 35} minLength={1} />
                              </span>
                              <span className="sr-only">{winner}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="lottery-level-pending">
                          <span>{hidden ? '正在生成中奖号码' : '等待开奖'}</span>
                          <i aria-hidden="true" />
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  )
}
