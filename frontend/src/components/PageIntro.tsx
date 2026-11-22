import type { ReactNode } from 'react'

interface PageIntroProps {
  eyebrow: string
  title: ReactNode
  description?: string
  className?: string
}

export default function PageIntro({ eyebrow, title, description, className = '' }: PageIntroProps) {
  return (
    <header className={`page-intro${className ? ` ${className}` : ''}`}>
      <p className="section-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  )
}
