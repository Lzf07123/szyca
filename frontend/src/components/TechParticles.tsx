import { useEffect, useState } from 'react'
import Particles, { initParticlesEngine } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'

interface ParticlePalette {
  primary: string
  secondary: string
}

// 科技感粒子网络：悬浮节点 + 连线，叠加在照片轮播之上
export default function TechParticles() {
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

  if (!palette) return null

  return (
    <Particles
      id="tech-particles"
      options={{
        background: { color: { value: 'transparent' } },
        fpsLimit: 45,
        detectRetina: false,
        particles: {
          number: { value: 36, density: { enable: true } },
          color: { value: [palette.primary, palette.primary, palette.secondary] },
          links: {
            enable: true,
            color: palette.primary,
            opacity: 0.18,
            distance: 150,
            width: 1,
          },
          move: { enable: true, speed: 0.65, outModes: 'out' },
          opacity: { value: 0.46 },
          size: { value: 1.5 },
        },
      }}
    />
  )
}
