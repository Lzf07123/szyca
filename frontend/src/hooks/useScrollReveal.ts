import { useEffect } from 'react'

export function useScrollReveal(routeKey: string) {
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('#main-content')
    if (!main) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || !('IntersectionObserver' in window)) {
      main.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => {
        element.classList.add('is-revealed')
      })
      return
    }

    const observed = new WeakSet<Element>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-revealed')
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -7% 0px' },
    )

    const register = () => {
      main.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => {
        if (observed.has(element)) return
        observed.add(element)
        observer.observe(element)
      })
    }

    const onFocus = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-reveal]')
      if (target) target.classList.add('is-revealed')
    }

    register()
    const frame = window.requestAnimationFrame(register)
    const mutations = new MutationObserver(register)
    mutations.observe(main, { childList: true, subtree: true })
    main.addEventListener('focusin', onFocus)

    return () => {
      window.cancelAnimationFrame(frame)
      mutations.disconnect()
      main.removeEventListener('focusin', onFocus)
      observer.disconnect()
    }
  }, [routeKey])
}
