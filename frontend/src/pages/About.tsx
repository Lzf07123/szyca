import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SitePage } from '../api/site'
import PageIntro from '../components/PageIntro'
import { usePageMeta } from '../components/PageMeta'

export default function About() {
  const [page, setPage] = useState<SitePage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  usePageMeta(
    page?.title ? `${page.title} · 计算机协会` : '关于协会 · 计算机协会',
    page?.summary || '了解汕头职业技术学院计算机协会。',
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void api<{ page: SitePage }>('/api/content/pages/about')
      .then((data) => {
        if (alive) setPage(data.page)
      })
      .catch((cause) => {
        if (alive) setError((cause as Error).message || '关于协会页面暂时不可用')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const paragraphs = (page?.body || '')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  return (
    <div className="join-page about-page">
      {loading && (
        <section className="state-page" role="status" aria-live="polite">
          <p className="eyebrow">ABOUT / LOADING</p>
          <h1>正在读取协会介绍</h1>
        </section>
      )}
      {!loading && error && (
        <section className="state-page" role="alert">
          <p className="eyebrow">ABOUT / UNAVAILABLE</p>
          <h1>关于协会页面暂时不可用</h1>
          <p>{error}</p>
          <button className="btn btn-primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
            重新加载
          </button>
        </section>
      )}
      {!loading && !error && page && (
        <>
          <PageIntro
            eyebrow="ABOUT / 关于协会"
            title={page.title}
            description={page.summary}
          />
          <article className="card">
            {paragraphs.map((paragraph, index) => (
              <p className={index === 0 ? undefined : 'muted'} key={`${index}-${paragraph.slice(0, 16)}`}>
                {paragraph}
              </p>
            ))}
            {paragraphs.length === 0 && <p className="muted">协会介绍正在整理中。</p>}
          </article>
        </>
      )}
    </div>
  )
}
