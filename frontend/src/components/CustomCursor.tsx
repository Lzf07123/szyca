import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, [role="button"], [tabindex]:not([tabindex="-1"])'

export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine) and (hover: hover)').matches
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dot = dotRef.current
    if (!finePointer || reducedMotion || !dot) return

    document.documentElement.classList.add('custom-cursor-active')

    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight / 2
    let currentX = targetX
    let currentY = targetY
    let currentScale = 1
    let targetScale = 1
    let frame = 0
    let visible = false

    const render = () => {
      frame = 0
      currentX += (targetX - currentX) * 0.18
      currentY += (targetY - currentY) * 0.18
      currentScale += (targetScale - currentScale) * 0.2
      dot.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%) scale(${currentScale})`

      if (
        Math.abs(targetX - currentX) > 0.1 ||
        Math.abs(targetY - currentY) > 0.1 ||
        Math.abs(targetScale - currentScale) > 0.01
      ) {
        frame = window.requestAnimationFrame(render)
      }
    }

    const scheduleRender = () => {
      if (!frame) frame = window.requestAnimationFrame(render)
    }

    const show = () => {
      if (visible) return
      visible = true
      dot.classList.add('is-visible')
    }

    const hide = () => {
      visible = false
      dot.classList.remove('is-visible')
    }

    const onPointerMove = (event: PointerEvent) => {
      targetX = event.clientX
      targetY = event.clientY
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(INTERACTIVE_SELECTOR)
        : null
      const disabled = Boolean(target?.matches(':disabled, [aria-disabled="true"]'))
      targetScale = target && !disabled ? 2.2 : 1
      dot.classList.toggle('is-interactive', Boolean(target) && !disabled)
      show()
      scheduleRender()
    }

    const onPointerLeave = (event: PointerEvent) => {
      if (event.relatedTarget === null) hide()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') hide()
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.documentElement.classList.remove('custom-cursor-active')
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return createPortal(
    <div ref={dotRef} className="custom-cursor" aria-hidden="true" />,
    document.body,
  )
}
