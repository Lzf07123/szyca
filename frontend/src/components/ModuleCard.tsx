import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

export type ModuleKind = 'quiz' | 'rank' | 'join' | 'lottery'

function ModuleIcon({ kind }: { kind: ModuleKind }) {
  if (kind === 'quiz') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4.5h14v15H5z" />
        <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
        <path d="m15.5 16.5 1.3 1.2 2.3-2.5" />
      </svg>
    )
  }
  if (kind === 'rank') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 19.5h15" />
        <path d="M6.5 16V11h3v5M10.5 16V6h3v10M14.5 16V8.5h3V16" />
      </svg>
    )
  }
  if (kind === 'lottery') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16v3.2a2.8 2.8 0 0 0 0 3.6V17H4v-3.2a2.8 2.8 0 0 0 0-3.6Z" />
        <path d="M9 10v4M13 10v4" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 13.5a4 4 0 1 1 2-3.1l2.5-2.5 2.2 2.2-2.5 2.5a4 4 0 0 1-3.2 4 4 4 0 0 1-1-3.1Z" />
      <path d="m16 5 3 3M14.5 6.5l3 3M5 19l5-5" />
    </svg>
  )
}

export function Arrow() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  )
}

export default function ModuleCard({
  id,
  kind,
  number,
  title,
  description,
  to,
  openLabel = 'OPEN MODULE',
}: {
  id?: string
  kind: ModuleKind
  number: number
  title: string
  description: string
  to: string
  openLabel?: string
}) {
  const english = kind.toUpperCase()
  return (
    <article
      id={id}
      className={`module-card module-${kind}`}
      data-module-key={kind}
      data-reveal
      style={{ '--reveal-delay': `${(number - 1) * 90}ms` } as CSSProperties}
    >
      <Link to={to} aria-label={`进入${title}模块`}>
        <div className="module-topline">
          <span className="module-number">[{String(number).padStart(2, '0')}]</span>
          <span className="module-index">NEBULA / {english}</span>
        </div>
        <div className="module-icon"><ModuleIcon kind={kind} /></div>
        <div className="module-copy">
          <p>{english} / MODULE</p>
          <h3>{title} <span>{english}</span></h3>
          <p className="module-description">{description}</p>
        </div>
        <span className="module-open">{openLabel} <Arrow /></span>
      </Link>
    </article>
  )
}
