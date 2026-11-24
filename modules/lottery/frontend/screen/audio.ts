import { useCallback, useEffect, useRef, useState } from 'react'

export type LotteryCue = 'arm' | 'reveal' | 'finale' | 'alert'

type AudioContextConstructor = typeof AudioContext

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const legacyWindow = window as typeof window & {
    webkitAudioContext?: AudioContextConstructor
  }
  return window.AudioContext ?? legacyWindow.webkitAudioContext ?? null
}

class LotteryAudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null

  async enable() {
    const Context = getAudioContextConstructor()
    if (!Context) return false
    if (!this.context || this.context.state === 'closed') {
      this.context = new Context()
      this.master = this.context.createGain()
      this.master.gain.value = 0.34
      const compressor = this.context.createDynamicsCompressor()
      compressor.threshold.value = -20
      compressor.knee.value = 16
      compressor.ratio.value = 4
      compressor.attack.value = 0.006
      compressor.release.value = 0.24
      this.master.connect(compressor)
      compressor.connect(this.context.destination)
    }
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
    this.play('arm', 0)
    return true
  }

  disable() {
    if (!this.context || this.context.state === 'closed') return
    void this.context.suspend()
  }

  play(cue: LotteryCue, step = 0) {
    const context = this.context
    if (!context || context.state !== 'running') return
    const start = context.currentTime + 0.015
    try {
      if (cue === 'arm') this.playArm(start)
      if (cue === 'reveal') this.playReveal(start, step)
      if (cue === 'finale') this.playFinale(start)
      if (cue === 'alert') this.playAlert(start)
    } catch {
      // Audio is enhancement only; unsupported devices must not affect the draw.
    }
  }

  destroy() {
    if (!this.context || this.context.state === 'closed') return
    void this.context.close()
    this.context = null
    this.master = null
  }

  private tone({
    frequency,
    start,
    duration,
    gain,
    slideTo,
    type = 'sine',
  }: {
    frequency: number
    start: number
    duration: number
    gain: number
    slideTo?: number
    type?: OscillatorType
  }) {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    if (slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, slideTo),
        start + duration,
      )
    }
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.018)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(envelope)
    envelope.connect(master)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.04)
  }

  private noise({
    start,
    duration,
    gain,
    from,
    to,
    q = 0.9,
  }: {
    start: number
    duration: number
    gain: number
    from: number
    to: number
    q?: number
  }) {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const size = Math.max(1, Math.ceil(context.sampleRate * duration))
    const buffer = context.createBuffer(1, size, context.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let index = 0; index < size; index += 1) {
      channel[index] = Math.random() * 2 - 1
    }
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.Q.value = q
    filter.frequency.setValueAtTime(Math.max(40, from), start)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + duration)
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.08)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(master)
    source.start(start)
    source.stop(start + duration + 0.02)
  }

  private playArm(start: number) {
    for (let index = 0; index < 8; index += 1) {
      const offset = index * 0.085
      this.tone({
        frequency: 92 + index * 9,
        start: start + offset,
        duration: 0.07,
        gain: 0.035 + index * 0.003,
        type: 'triangle',
      })
    }
    this.tone({
      frequency: 72,
      slideTo: 210,
      start,
      duration: 0.76,
      gain: 0.04,
      type: 'sawtooth',
    })
    this.noise({
      start,
      duration: 0.78,
      gain: 0.028,
      from: 180,
      to: 4600,
      q: 1.3,
    })
  }

  private playReveal(start: number, step: number) {
    const lift = 2 ** ((step % 5) / 12)
    this.noise({
      start,
      duration: 0.36,
      gain: 0.055,
      from: 520,
      to: 6200,
      q: 1.5,
    })
    const chord = [1, 1.5, 2]
    chord.forEach((ratio, index) => {
      this.tone({
        frequency: (480 + index * 80) * lift * ratio,
        start: start + index * 0.055,
        duration: 0.54,
        gain: 0.045 / (index + 1),
        type: index === 0 ? 'triangle' : 'sine',
      })
    })
  }

  private playFinale(start: number) {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((frequency, index) => {
      this.tone({
        frequency,
        start: start + index * 0.09,
        duration: 0.9,
        gain: 0.045,
        type: 'triangle',
      })
    })
    this.tone({
      frequency: 130.81,
      start,
      duration: 1.1,
      gain: 0.025,
      type: 'sine',
    })
    this.noise({
      start: start + 0.18,
      duration: 0.95,
      gain: 0.032,
      from: 3200,
      to: 720,
      q: 0.7,
    })
  }

  private playAlert(start: number) {
    this.tone({
      frequency: 220,
      start,
      duration: 0.19,
      gain: 0.038,
      type: 'square',
    })
    this.tone({
      frequency: 174.61,
      start: start + 0.24,
      duration: 0.24,
      gain: 0.032,
      type: 'triangle',
    })
  }
}

export function useLotteryAudio() {
  const engineRef = useRef<LotteryAudioEngine | null>(null)
  const enabledRef = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const [supported] = useState(() => Boolean(getAudioContextConstructor()))

  const toggle = useCallback(async () => {
    if (!supported) return
    if (!engineRef.current) engineRef.current = new LotteryAudioEngine()
    if (enabledRef.current) {
      enabledRef.current = false
      setEnabled(false)
      engineRef.current.disable()
      return
    }
    try {
      const ready = await engineRef.current.enable()
      enabledRef.current = ready
      setEnabled(ready)
    } catch {
      enabledRef.current = false
      setEnabled(false)
    }
  }, [supported])

  const play = useCallback((cue: LotteryCue, step = 0) => {
    if (enabledRef.current) engineRef.current?.play(cue, step)
  }, [])

  useEffect(() => () => {
    engineRef.current?.destroy()
    engineRef.current = null
  }, [])

  return { enabled, supported, toggle, play }
}
