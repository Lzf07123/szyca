import { useEffect, useState } from 'react'
import Particles, { initParticlesEngine } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'

// 科技感粒子网络：悬浮节点 + 连线，叠加在照片轮播之上
export default function TechParticles() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let alive = true
    initParticlesEngine(async (engine) => {
      await loadSlim(engine)
    }).then(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!ready) return null

  return (
    <Particles
      id="tech-particles"
      options={{
        background: { color: { value: 'transparent' } },
        fpsLimit: 45,
        detectRetina: false,
        particles: {
          number: { value: 36, density: { enable: true } },
          color: { value: ['#7FD4C6', '#25786D'] },
          links: {
            enable: true,
            color: '#25786D',
            opacity: 0.2,
            distance: 150,
            width: 1,
          },
          move: { enable: true, speed: 0.8, outModes: 'out' },
          opacity: { value: 0.38 },
          size: { value: 1.5 },
        },
      }}
    />
  )
}
