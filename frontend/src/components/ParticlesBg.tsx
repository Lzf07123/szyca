import { useEffect, useState } from 'react'
import Particles, { initParticlesEngine } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'

interface ParticlePalette {
  primary: string
  secondary: string
}

export default function ParticlesBg() {
  const [palette, setPalette] = useState<ParticlePalette | null>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let alive = true
    const root = getComputedStyle(document.documentElement)
    const primary = root.getPropertyValue('--particle-primary').trim()
    const secondary = root.getPropertyValue('--particle-secondary').trim()
    if (!primary || !secondary) return
    initParticlesEngine(async (engine) => {
      await loadSlim(engine)
    }).then(() => {
      if (alive) setPalette({ primary, secondary })
    })
    return () => {
      alive = false
    }
  }, [])

  if (!palette) return <div className="particles-fallback" />

  return (
    <Particles
      id="tsparticles"
      options={{
        background: { color: { value: 'transparent' } },
        fpsLimit: 60,
        detectRetina: true,
        particles: {
          number: { value: 64, density: { enable: true } },
          color: { value: [palette.primary, palette.primary, palette.secondary] },
          links: { enable: true, color: palette.primary, opacity: 0.16, distance: 140 },
          move: { enable: true, speed: 0.8 },
          opacity: { value: 0.42 },
          size: { value: 2 },
        },
      }}
    />
  )
}
