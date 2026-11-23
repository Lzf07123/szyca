import { useEffect, useState } from 'react'

const RANDOM_CHARS = Array.from('01<>/\\[]{}#%+=*_')
const HOLD_MS = 180

function randomChar() {
  return RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)] ?? '#'
}

function randomize(text: string) {
  return Array.from(text).map((char) => (
    char === ' ' || char === '\u3000' ? char : randomChar()
  ))
}

export default function ScrambleText({ text, delay = 0 }: { text: string; delay?: number }) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const correct = Array.from(text)
  const eligible = correct.length >= 3 && correct.length <= 16
  const [visible, setVisible] = useState<string[]>(() => (
    eligible && !reducedMotion ? randomize(text) : correct
  ))

  useEffect(() => {
    const characters = Array.from(text)
    if (!eligible || reducedMotion) {
      setVisible(characters)
      return
    }

    setVisible(randomize(text))
    let frame = 0
    let lastPaint = 0
    const revealMs = Math.min(520, Math.max(320, characters.length * 42))
    const start = performance.now() + delay

    const tick = (now: number) => {
      const elapsed = now - start
      if (elapsed < 0) {
        frame = window.requestAnimationFrame(tick)
        return
      }

      if (now - lastPaint >= 36) {
        lastPaint = now
        const revealed = elapsed <= HOLD_MS
          ? 0
          : Math.min(
            characters.length,
            Math.floor(((elapsed - HOLD_MS) / revealMs) * characters.length),
          )
        setVisible(characters.map((char, index) => (
          index < revealed || char === ' ' || char === '\u3000'
            ? char
            : randomChar()
        )))
      }

      if (elapsed < HOLD_MS + revealMs) {
        frame = window.requestAnimationFrame(tick)
      } else {
        setVisible(characters)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [delay, eligible, reducedMotion, text])

  if (!eligible || reducedMotion) return <>{text}</>

  return (
    <>
      {visible.map((char, index) => (
        <span className="scramble-char" key={index}>
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </>
  )
}
