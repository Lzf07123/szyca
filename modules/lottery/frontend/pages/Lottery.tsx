import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PageIntro from '@core/components/PageIntro'
import PageMeta from '@core/components/PageMeta'
import { api, getToken, randomID } from '@core/api/client'
import { useSite } from '@core/api/site'

interface Campaign {
  id: number
  name: string
  status: 'draft' | 'active' | 'paused' | 'ended'
  state: 'upcoming' | 'active' | 'paused' | 'ended'
  starts_at?: string
  ends_at?: string
  eligibility: 'completed_round' | 'min_score'
  eligibility_min_score?: number
  prizes: Array<{ name: string; remaining: number }>
}

interface Draw {
  id: number
  result: 'won' | 'no_win' | 'claimed'
  prize?: { id: number; name: string }
  claimed: boolean
  created_at: string
}

interface CampaignResponse {
  campaign: Campaign | null
  draw?: Draw
  eligible?: boolean
}

const errorCopy: Record<string, string> = {
  not_eligible: '完成至少一轮答题后即可参与本次抽奖。',
  already_drawn: '你已经参与过这个活动，每个账号仅可抽取一次。',
  campaign_not_active: '活动尚未开始、已暂停或已经结束。',
  feature_disabled: '抽奖模块当前未开放。',
  rate_limited: '操作过于频繁，请稍后重试。',
}

function campaignState(campaign: Campaign | null) {
  if (!campaign) return '暂无可参与活动'
  if (campaign.state === 'active') return '活动进行中'
  if (campaign.state === 'paused') return '活动暂停'
  if (campaign.state === 'ended') return '活动已结束'
  return '活动未开始'
}

function formatWindow(campaign: Campaign) {
  if (!campaign.starts_at && !campaign.ends_at) return '以现场公告为准'
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const start = campaign.starts_at ? formatter.format(new Date(campaign.starts_at)) : '现在'
  const end = campaign.ends_at ? formatter.format(new Date(campaign.ends_at)) : '现场结束'
  return `${start} — ${end}`
}

export default function Lottery() {
  const { site } = useSite()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [draw, setDraw] = useState<Draw | undefined>()
  const [eligible, setEligible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestID = useRef(randomID())
  const authenticated = Boolean(getToken())

  useEffect(() => {
    let alive = true
    void api<CampaignResponse>('/api/lottery/campaign')
      .then((response) => {
        if (!alive) return
        setCampaign(response.campaign)
        setDraw(response.draw)
        setEligible(Boolean(response.eligible))
        if (response.campaign) requestID.current = randomID()
      })
      .catch((cause) => {
        if (alive) setError((cause as Error).message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const drawNow = async () => {
    if (drawing) return
    setDrawing(true)
    setError('')
    setMessage('')
    try {
      const response = await api<Draw>('/api/lottery/draw', {
        method: 'POST',
        body: JSON.stringify({ request_id: requestID.current }),
      })
      setDraw(response)
      setMessage(response.result === 'won' ? '恭喜中奖，请按现场指引领取。' : '谢谢参与，下一场活动再见。')
    } catch (cause) {
      const failure = cause as Error & { code?: string }
      setError(errorCopy[failure.code || ''] || failure.message || '抽奖暂时失败，请稍后重试。')
    } finally {
      setDrawing(false)
    }
  }

  const canDraw = authenticated && eligible && campaign?.state === 'active' && !draw
  const blockedReason = !campaign
    ? '当前没有可参与的抽奖活动。'
    : !eligible
      ? '完成至少一轮答题后，抽取按钮将自动解锁。'
      : campaign.state === 'upcoming'
        ? '活动尚未开始，请留意现场公告。'
        : campaign.state === 'paused'
          ? '活动已暂停，恢复后可直接参与。'
          : campaign.state === 'ended'
            ? '本场活动已经结束，请关注下一场活动。'
            : ''

  return (
    <>
      <PageMeta
        title={`招新抽奖 · ${site.brand.name}`}
        description="完成答题后参与计算机协会现场抽奖，抽取结果由服务端公平生成。"
      />
      <section className="lottery-page">
        <PageIntro
          eyebrow="FAIR DRAW / 现场抽奖"
          title="现场抽奖"
          description="完成答题，带走一份好运。每个账号限参与一次，奖品、时间与资格均由服务端校验。"
        />
        <div className="lottery-layout">
          <div className="lottery-copy">
            <p className="section-eyebrow">HOW IT WORKS / 参与步骤</p>
            <h2>三步完成抽取</h2>
            <ol className="lottery-steps">
              <li><span>01</span>完成一轮答题</li>
              <li><span>02</span>确认活动进行中</li>
              <li><span>03</span>点击抽取并保存结果</li>
            </ol>
          </div>
          <div className="lottery-card">
          <div className="lottery-card-head">
            <span className={`status-dot${campaign?.state === 'active' ? ' live' : ''}`} aria-hidden="true" />
            <strong>{loading ? '正在读取活动…' : campaignState(campaign)}</strong>
          </div>
          {campaign ? (
            <>
              <h2>{campaign.name}</h2>
              <dl className="lottery-meta">
                <div><dt>活动时间</dt><dd>{formatWindow(campaign)}</dd></div>
                <div>
                  <dt>参与条件</dt>
                  <dd>
                    {campaign.eligibility === 'min_score'
                      ? `最佳成绩达到 ${campaign.eligibility_min_score ?? 0} 分`
                      : '完成至少一轮答题'}
                  </dd>
                </div>
              </dl>
              {campaign.prizes.length > 0 && (
                <div className="lottery-prizes">
                  <span>本期奖品</span>
                  <ul>
                    {campaign.prizes.map((prize) => (
                      <li key={prize.name}>
                        <span>{prize.name}</span>
                        <small>剩余 {prize.remaining}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {draw ? (
                <div className={`draw-result ${draw.result === 'won' ? 'won' : 'neutral'}`} aria-live="polite">
                  <span>{draw.result === 'no_win' ? 'THANKS' : 'YOU WON'}</span>
                  <strong>{draw.result === 'no_win' ? '谢谢参与' : draw.prize?.name || '抽奖奖品'}</strong>
                  <p>{draw.claimed ? '已领取' : draw.result === 'no_win' ? '本次未中奖，不扣除奖品库存。' : '请向现场工作人员出示本结果领取。'}</p>
                </div>
              ) : !authenticated ? (
                <div className="lottery-action">
                  <p>登录答题身份后才能验证参与资格。</p>
                  <Link className="btn btn-primary" to="/quiz">前往答题并登录</Link>
                </div>
              ) : (
                <div className="lottery-action">
                  <button
                    className="btn btn-primary draw-button"
                    type="button"
                    disabled={!canDraw || drawing}
                    aria-busy={drawing}
                    onClick={() => void drawNow()}
                  >
                    {drawing
                      ? '正在抽取…'
                      : canDraw
                        ? '开始抽奖'
                        : !eligible
                          ? '完成答题后解锁'
                          : campaign.state === 'paused'
                            ? '活动暂停中'
                            : campaign.state === 'ended'
                              ? '活动已结束'
                              : '等待活动开始'}
                  </button>
                  {blockedReason && <p>{blockedReason}</p>}
                </div>
              )}
            </>
          ) : (
            <div className="lottery-empty">
              <strong>活动尚未配置</strong>
              <p>管理员开放活动后会在这里显示奖品与参与条件。</p>
            </div>
          )}
            {message && <p className="form-success" role="status">{message}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </div>
      </section>
    </>
  )
}
