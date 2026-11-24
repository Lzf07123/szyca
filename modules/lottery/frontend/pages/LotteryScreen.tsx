import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@core/api/client'
import { useLogoURL, useSite } from '@core/api/site'
import BrandMark from '@core/components/BrandMark'
import PageMeta from '@core/components/PageMeta'
import ScrambleText from '@core/components/ScrambleText'
import { QuizSocket, wsURL } from '@core/ws/socket'
import { useLotteryAudio } from '../screen/audio'

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

function connectionLabel(state: 'connecting' | 'online' | 'offline') {
  if (state === 'online') return '实时连接'
  if (state === 'offline') return '自动重连中'
  return '连接中'
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
  const alertSounded = useRef(false)
  const resultBoardRef = useRef<HTMLDivElement>(null)
  const audio = useLotteryAudio()

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
      audio.play('finale')
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
  }, [audio.play])

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
          alertSounded.current = false
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
          alertSounded.current = false
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
    if (!syncError || alertSounded.current) return
    alertSounded.current = true
    audio.play('alert')
  }, [audio.play, syncError])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        return
      }
      if (event.key.toLowerCase() !== 'm') return
      event.preventDefault()
      void audio.toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [audio.toggle])

  useEffect(() => {
    if (!revealSequence) return
    audio.play(revealSequence.index === 0 ? 'arm' : 'reveal', revealSequence.index)
  }, [audio.play, revealSequence])

  useEffect(() => {
    const resultBoard = resultBoardRef.current
    if (!resultBoard || revealSequence) return
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotionQuery.matches) return

    const winnerGrids = Array.from(
      resultBoard.querySelectorAll<HTMLElement>('.lottery-winner-grid'),
    )
    if (winnerGrids.length === 0) return

    let frame = 0
    let lastPaint = performance.now()
    const gridStates = winnerGrids.map((grid) => ({
      grid,
      focusPaused: false,
      resumeAt: 0,
      position: grid.scrollTop,
      maxScroll: Math.max(0, grid.scrollHeight - grid.clientHeight),
      syncAfterResume: false,
    }))
    const listeners: Array<() => void> = []
    const resizeObserver = new ResizeObserver(() => {
      for (const state of gridStates) {
        state.maxScroll = Math.max(0, state.grid.scrollHeight - state.grid.clientHeight)
        if (state.maxScroll > 4) state.position %= state.maxScroll
      }
    })

    const tick = (now: number) => {
      const elapsed = Math.min(32, now - lastPaint) / 1000
      for (const state of gridStates) {
        if (now >= state.resumeAt && state.syncAfterResume) {
          state.position = state.grid.scrollTop
          state.syncAfterResume = false
        }
        if (
          state.maxScroll > 4
          && !state.focusPaused
          && !document.hidden
          && now >= state.resumeAt
        ) {
          state.position += elapsed * 24
          if (state.position >= state.maxScroll) {
            state.position %= state.maxScroll
          }
          state.grid.scrollTop = state.position
        }
      }
      lastPaint = now
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)

    for (const state of gridStates) {
      const onFocusIn = () => {
        state.focusPaused = true
        state.position = state.grid.scrollTop
      }
      const onFocusOut = () => {
        state.focusPaused = false
        state.syncAfterResume = true
      }
      const onInteraction = () => {
        state.resumeAt = Math.max(state.resumeAt, performance.now() + 4000)
        state.syncAfterResume = true
      }
      state.grid.addEventListener('focusin', onFocusIn)
      state.grid.addEventListener('focusout', onFocusOut)
      state.grid.addEventListener('pointerdown', onInteraction)
      state.grid.addEventListener('wheel', onInteraction, { passive: true })
      resizeObserver.observe(state.grid)
      listeners.push(() => {
        state.grid.removeEventListener('focusin', onFocusIn)
        state.grid.removeEventListener('focusout', onFocusOut)
        state.grid.removeEventListener('pointerdown', onInteraction)
        state.grid.removeEventListener('wheel', onInteraction)
      })
    }

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      for (const cleanup of listeners) cleanup()
    }
  }, [board.levels, revealSequence])

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
      audio.play('finale')
      setAnnouncement(
        `${revealSequence.levelName}开奖完成，中奖号码：${revealSequence.winners.join('、')}`,
      )
      setRevealSequence(null)
    }, isLast ? 2200 : 1700)
    return () => window.clearTimeout(timer)
  }, [audio.play, revealSequence])

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
  const revealedLevelCount = board.levels.filter((level) => level.state === 'revealed').length
  const plannedWinnerCount = board.levels.reduce(
    (total, level) => total + level.winner_count,
    0,
  )
  const levelProgress = board.levels.length > 0
    ? Math.round((revealedLevelCount / board.levels.length) * 100)
    : 0
  const displayedRange = event
    ? `${event.range_start.padStart(event.number_width, '0')}–${event.range_end.padStart(event.number_width, '0')}`
    : ''
  const screenState = loading
    ? 'loading'
    : !board.enabled
      ? 'closed'
      : !event
        ? 'standby'
        : event.completed
          ? 'complete'
          : 'live'
  const currentRound = nextLevel
    ? board.levels.findIndex((level) => level.id === nextLevel.id) + 1
    : board.levels.length
  const wideNumberValues = Boolean(event && event.number_width > 4)

  return (
    <>
      <PageMeta
        title={`现场抽奖 · ${site.brand.name}`}
        description="计算机协会现场号码抽奖实时大屏，中奖号码在大屏实时公布。"
      />
      <section
        className={`lottery-screen${wideNumberValues ? ' wide-number-values' : ''}`}
        data-screen-state={screenState}
        data-audio-enabled={audio.enabled ? 'true' : 'false'}
        aria-labelledby="lottery-screen-title"
        tabIndex={0}
      >
        <div className="lottery-screen-atmosphere" aria-hidden="true">
          <span className="lottery-star-field lottery-star-field-a" />
          <span className="lottery-star-field lottery-star-field-b" />
          <span className="lottery-stage-grid" />
          <span className="lottery-stage-halo" />
          <span className="lottery-stage-beam" />
        </div>

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
            <small>{event?.completed ? 'FINAL VERIFICATION' : 'REAL-TIME DRAW PROTOCOL'}</small>
          </div>
          <div className="lottery-screen-head-tools">
            <div className="lottery-screen-connection" data-state={connection}>
              <i aria-hidden="true" />
              {connectionLabel(connection)}
            </div>
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
              <p>正在校验场次、实时链路与开奖状态。</p>
            </div>
          ) : !board.enabled ? (
            <div className="lottery-screen-state closed">
              <div className="lottery-idle-reticle" aria-hidden="true" />
              <p className="lottery-screen-kicker">SCREEN STANDBY</p>
              <h1 id="lottery-screen-title">号码抽奖大屏暂未开放</h1>
              <p>请留意现场通知，开放后将在此实时公布号码。</p>
            </div>
          ) : !event ? (
            <div className="lottery-screen-state standby">
              <div className="lottery-standby-orbit" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
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
                <div className="lottery-event-heading">
                  <p className="lottery-screen-kicker">
                    <i className="lottery-live-beacon" aria-hidden="true" />
                    {event.completed ? 'DRAW COMPLETE' : 'LIVE DRAW'}
                    <span> / {event.completed ? 'FINAL RESULT' : 'ON STAGE'}</span>
                  </p>
                  <h1 id="lottery-screen-title">{event.name}</h1>
                  <div className="lottery-screen-event-code">
                    <span>EVENT <b>{String(event.id).padStart(3, '0')}</b></span>
                    <span>REV <b>{String(event.revision).padStart(2, '0')}</b></span>
                    <span>{event.completed ? 'FINAL LOCKED' : `NEXT / ${nextLevel?.name ?? '待定'}`}</span>
                  </div>
                </div>
                <div className="lottery-screen-summary">
                  <span>号码范围 <b>{displayedRange}</b></span>
                  <span>中奖号码 <b>{drawnCount} / {plannedWinnerCount}</b></span>
                  <span className={`lottery-screen-state-chip${event.completed ? ' complete' : ''}`}>
                    {event.completed ? '本场已开完' : nextLevel ? `本轮 · ${nextLevel.name}` : '等待开奖'}
                  </span>
                </div>
              </div>

              <div className="lottery-signal-deck" aria-hidden="true">
                <span className="lottery-signal-deck-label">
                  <i />
                  SECURE STAGE LINK
                </span>
                <span className="lottery-signal-deck-wave">
                  {Array.from({ length: 28 }, (_, index) => (
                    <i key={index} style={{ height: `${20 + ((index * 29) % 72)}%` }} />
                  ))}
                </span>
                <span>EVENT <b>{String(event.id).padStart(3, '0')}</b></span>
                <span>ROUNDS <b>{revealedLevelCount}/{board.levels.length}</b></span>
                <span>NUMBERS <b>{drawnCount}/{plannedWinnerCount}</b></span>
                <span>
                  LINK <b>{connection === 'online' ? 'ONLINE' : connection === 'offline' ? 'RETRY' : 'WAIT'}</b>
                </span>
              </div>

              <div className="lottery-screen-progress" aria-hidden="true">
                <span>
                  <i style={{ transform: `scaleX(${levelProgress / 100})` }} />
                </span>
                <small>{revealedLevelCount} / {board.levels.length} ROUNDS</small>
              </div>

              <div className="lottery-screen-workspace">
                <aside className="lottery-screen-rail lottery-screen-rail-left" aria-hidden="true">
                  <div className="lottery-screen-rail-head">
                    <span>LIVE TELEMETRY</span>
                    <i />
                  </div>
                  <strong className="lottery-screen-rail-focus">
                    {event.completed ? 'FINAL' : `ROUND ${String(currentRound).padStart(2, '0')}`}
                  </strong>
                  <div className="lottery-terminal">
                    <div className="lottery-terminal-head">
                      <span>TTY / SZYCA-STAGE</span>
                      <i />
                    </div>
                    <div className="lottery-terminal-log">
                      <p><span>$</span> draw --follow --event {String(event.id).padStart(3, '0')}</p>
                      <p><span>›</span> state <b>{event.completed ? 'sealed' : 'streaming'}</b></p>
                      <p><span>›</span> protocol <b>csprng/verified</b></p>
                      <p>
                        <span>›</span> link
                        <b>{connection === 'online' ? 'ws/online' : connection === 'offline' ? 'ws/retry' : 'ws/wait'}</b>
                      </p>
                      <p><span>›</span> rounds <b>{revealedLevelCount}/{board.levels.length}</b></p>
                    </div>
                    <p className="lottery-terminal-cursor">
                      <span>root@szyca</span><b>:~</b>$ <i aria-hidden="true" />
                    </p>
                  </div>
                  <div className="lottery-telemetry-list">
                    <span><small>RANGE</small><b>{displayedRange}</b></span>
                    <span><small>WINNERS</small><b>{drawnCount} / {plannedWinnerCount}</b></span>
                    <span><small>LINK</small><b>{connectionLabel(connection)}</b></span>
                  </div>
                  <div className="lottery-signal-bars">
                    {Array.from({ length: 12 }, (_, index) => (
                      <i key={index} style={{ height: `${24 + ((index * 19) % 62)}%` }} />
                    ))}
                  </div>
                  <p>{event.completed ? 'ALL ROUNDS VERIFIED' : 'SERVER STATE / SYNCHRONIZED'}</p>
                </aside>

                <div className="lottery-screen-arena">
                  <span className="lottery-arena-corner top-left" aria-hidden="true" />
                  <span className="lottery-arena-corner top-right" aria-hidden="true" />
                  <span className="lottery-arena-corner bottom-left" aria-hidden="true" />
                  <span className="lottery-arena-corner bottom-right" aria-hidden="true" />
                  <div className="lottery-arena-head">
                    <span><i aria-hidden="true" /> RESULT MATRIX / 中奖结果</span>
                    <small>{event.completed ? 'FINAL LOCKED' : nextLevel ? `AWAITING · ${nextLevel.name}` : 'AWAITING DRAW'}</small>
                  </div>

                  <div
                    ref={resultBoardRef}
                    className={`lottery-result-board${board.levels.length > 2 ? ' dense' : ''}${revealSequence ? ' is-revealing' : ''}`}
                    tabIndex={0}
                    aria-label="中奖结果；内容较多时自动循环滚动，聚焦、触摸或手动滚动可暂停"
                  >
                    {board.levels.map((level, index) => {
                      const hidden = revealSequence?.levelID === level.id
                      return (
                        <section
                          className={[
                            'lottery-result-level',
                            level.state === 'revealed' ? 'revealed' : 'pending',
                            level.id === latestRevealedID ? 'latest' : '',
                            nextLevel?.id === level.id ? 'next' : '',
                            hidden ? 'currently-rolling' : '',
                          ].filter(Boolean).join(' ')}
                          key={level.id}
                          aria-labelledby={`lottery-level-${level.id}`}
                        >
                          <header>
                            <div>
                              <span className="lottery-level-index">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <div>
                                <h2 id={`lottery-level-${level.id}`}>{level.name}</h2>
                                <small>
                                  {level.state === 'revealed'
                                    ? `${level.winners.length} 位中奖者`
                                    : nextLevel?.id === level.id
                                      ? '等待开奖指令'
                                      : '列入本轮序列'}
                                </small>
                              </div>
                            </div>
                            <span className="lottery-level-status">
                              <i aria-hidden="true" />
                              {level.state === 'revealed' ? 'REVEALED' : 'STANDBY'}
                            </span>
                          </header>
                          {level.state === 'revealed' && !hidden ? (
                            <ol
                              className="lottery-winner-grid"
                              tabIndex={0}
                              aria-label={`${level.name}中奖号码；内容较多时自动循环滚动，聚焦、触摸或手动滚动可暂停`}
                            >
                              {level.winners.map((winner, winnerIndex) => (
                                <li key={winner}>
                                  <span className="lottery-winner-order" aria-hidden="true">
                                    {String(winnerIndex + 1).padStart(2, '0')}
                                  </span>
                                  <span className="lottery-winner-value" aria-hidden="true">
                                    <ScrambleText text={winner} delay={winnerIndex * 35} minLength={1} />
                                  </span>
                                  <span className="sr-only">{winner}</span>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div className="lottery-level-pending">
                              <span className="lottery-pending-radar" aria-hidden="true"><i /></span>
                              <div>
                                <strong>{hidden ? '正在生成中奖号码' : '等待开奖'}</strong>
                                <small>{hidden ? 'VERIFYING RANDOM RESULT' : `${level.winner_count} 个号码将在现场揭晓`}</small>
                              </div>
                              <i aria-hidden="true" />
                            </div>
                          )}
                        </section>
                      )
                    })}
                  </div>

                  <div className="lottery-arena-foot" aria-hidden="true">
                    <span>PROTOCOL / NUMBER-DRAW</span>
                    <span className="lottery-arena-foot-line" />
                    <span>{event.completed ? 'COMPLETE' : 'LIVE SIGNAL'}</span>
                  </div>
                </div>

                <aside className="lottery-screen-rail lottery-screen-rail-right" aria-hidden="true">
                  <div className="lottery-screen-rail-head">
                    <span>ROUND SCHEDULE</span>
                    <i />
                  </div>
                  <ol className="lottery-round-list">
                    {board.levels.map((level, index) => (
                      <li
                        key={level.id}
                        className={[
                          level.state === 'revealed' ? 'revealed' : '',
                          nextLevel?.id === level.id ? 'next' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <strong>{level.name}</strong>
                          <small>{level.state === 'revealed' ? '已完成' : nextLevel?.id === level.id ? '下一轮' : '待命'}</small>
                        </div>
                        <b>{level.winner_count}</b>
                      </li>
                    ))}
                  </ol>
                  <div className="lottery-round-progress">
                    <span style={{ transform: `scaleX(${levelProgress / 100})` }} />
                  </div>
                  <p>{levelProgress}% COMPLETE</p>
                </aside>
              </div>
            </>
          )}
        </div>

        {revealSequence && (
          <div
            className="lottery-sequence-stage"
            data-sequence-index={revealSequence.index}
            aria-live="polite"
          >
            <div className="lottery-sequence-atmosphere" aria-hidden="true">
              <span className="lottery-sequence-ring ring-outer" />
              <span className="lottery-sequence-ring ring-middle" />
              <span className="lottery-sequence-ring ring-inner" />
              <span className="lottery-sequence-beam beam-left" />
              <span className="lottery-sequence-beam beam-right" />
              <span className="lottery-sequence-scan" />
            </div>
            <div className="lottery-sequence-content">
              <div className="lottery-sequence-head">
                <span>
                  <i aria-hidden="true" />
                  LEVEL {String(revealSequence.index + 1).padStart(2, '0')}
                </span>
                <strong>{revealSequence.levelName}</strong>
                <small>
                  {revealSequence.index + 1} / {revealSequence.winners.length}
                </small>
              </div>
              <div className="lottery-sequence-frame">
                <span className="lottery-sequence-caption">WINNING NUMBER</span>
                <strong key={`${revealSequence.levelID}-${revealSequence.index}`} aria-hidden="true">
                  <ScrambleText
                    text={revealSequence.winners[revealSequence.index]}
                    minLength={1}
                  />
                </strong>
                <span className="lottery-sequence-counter">
                  NO. {String(revealSequence.index + 1).padStart(2, '0')}
                </span>
              </div>
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
          </div>
        )}
      </section>
    </>
  )
}
