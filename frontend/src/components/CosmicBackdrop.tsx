import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  glow: number
}

const PARTICLE_COUNT = 90
const LINK_DISTANCE = 110
const CURSOR_DISTANCE = 190

function makeParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.16,
    vy: (Math.random() - 0.5) * 0.16,
    size: 0.7 + Math.random() * 1.3,
    glow: Math.random(),
  }))
}

export default function CosmicBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rootStyle = getComputedStyle(document.documentElement)
    const primary = rootStyle.getPropertyValue('--particle-primary').trim()
    const secondary = rootStyle.getPropertyValue('--particle-secondary').trim()
    if (!primary || !secondary) return
    let width = window.innerWidth
    let height = window.innerHeight
    let particles = makeParticles(width, height)
    let frame = 0
    const pointer = { x: -1000, y: -1000, active: false }

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      particles = makeParticles(width, height)
      if (reducedMotion) draw()
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)

      if (!reducedMotion) {
        for (const particle of particles) {
          if (pointer.active) {
            const dx = pointer.x - particle.x
            const dy = pointer.y - particle.y
            const distance = Math.hypot(dx, dy)
            if (distance > 0 && distance < CURSOR_DISTANCE) {
              const force = (1 - distance / CURSOR_DISTANCE) * 0.018
              particle.vx += (dx / distance) * force
              particle.vy += (dy / distance) * force
            }
          }

          particle.vx *= 0.995
          particle.vy *= 0.995
          particle.vx = Math.max(-0.32, Math.min(0.32, particle.vx))
          particle.vy = Math.max(-0.32, Math.min(0.32, particle.vy))
          particle.x += particle.vx
          particle.y += particle.vy

          if (particle.x < -10) particle.x = width + 10
          if (particle.x > width + 10) particle.x = -10
          if (particle.y < -10) particle.y = height + 10
          if (particle.y > height + 10) particle.y = -10
        }
      }

      context.lineWidth = 0.7
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const distance = Math.hypot(dx, dy)
          if (distance >= LINK_DISTANCE) continue
          const alpha = (1 - distance / LINK_DISTANCE) * 0.24
          context.globalAlpha = alpha
          context.strokeStyle = primary
          context.beginPath()
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.stroke()
        }
      }

      for (let index = 0; index < particles.length; index++) {
        const particle = particles[index]
        const color = particle.glow > 0.92 ? secondary : primary
        context.globalAlpha = 0.34 + particle.glow * 0.46
        context.fillStyle = color
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
    }

    const animate = () => {
      draw()
      frame = window.requestAnimationFrame(animate)
    }

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.active = true
    }

    const onPointerLeave = () => {
      pointer.active = false
    }

    resize()
    window.addEventListener('resize', resize, { passive: true })

    if (reducedMotion) {
      draw()
    } else {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('pointerleave', onPointerLeave, { passive: true })
      frame = window.requestAnimationFrame(animate)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [])

  return (
    <div className="cosmic-field" aria-hidden="true">
      <div className="cosmic-grid" />
      <div className="cosmic-aurora cosmic-aurora-primary" />
      <div className="cosmic-aurora cosmic-aurora-secondary" />
      <canvas
        ref={canvasRef}
        className="cosmic-canvas"
        data-nodes={PARTICLE_COUNT}
        data-link-distance={LINK_DISTANCE}
        data-gravity-distance={CURSOR_DISTANCE}
      />
      <div className="cosmic-vignette" />
    </div>
  )
}
