import { useEffect } from 'react'

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = description
  }, [title, description])
}

export default function PageMeta({ title, description }: { title: string; description: string }) {
  usePageMeta(title, description)
  return null
}
