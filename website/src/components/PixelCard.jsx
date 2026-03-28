import { useEffect, useRef } from 'react'
import './PixelCard.css'

class Pixel {
  constructor(canvas, context, x, y, color, speed, delay) {
    this.width = canvas.width
    this.height = canvas.height
    this.ctx = context
    this.x = x
    this.y = y
    this.color = color
    this.speed = this.getRandomValue(0.1, 0.9) * speed
    this.size = 0
    this.sizeStep = Math.random() * 0.4
    this.minSize = 0.5
    this.maxSizeInteger = 2
    this.maxSize = this.getRandomValue(this.minSize, this.maxSizeInteger)
    this.delay = delay
    this.counter = 0
    this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01
    this.isIdle = false
    this.isReverse = false
    this.isShimmer = false
  }
  getRandomValue(min, max) { return Math.random() * (max - min) + min }
  draw() {
    const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5
    this.ctx.fillStyle = this.color
    this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size)
  }
  appear() {
    this.isIdle = false
    if (this.counter <= this.delay) { this.counter += this.counterStep; return }
    if (this.size >= this.maxSize) { this.isShimmer = true }
    if (this.isShimmer) { this.shimmer() } else { this.size += this.sizeStep }
    this.draw()
  }
  disappear() {
    this.isShimmer = false
    this.counter = 0
    if (this.size <= 0) { this.isIdle = true; return }
    this.size -= 0.1
    this.draw()
  }
  shimmer() {
    if (this.size >= this.maxSize) { this.isReverse = true }
    else if (this.size <= this.minSize) { this.isReverse = false }
    if (this.isReverse) { this.size -= this.speed } else { this.size += this.speed }
  }
}

function getEffectiveSpeed(value, reducedMotion) {
  const parsed = parseInt(value, 10)
  if (parsed <= 0 || reducedMotion) return 0
  if (parsed >= 100) return 0.1
  return parsed * 0.001
}

const VARIANTS = {
  default: { activeColor: null, gap: 5,  speed: 35, colors: '#f8fafc,#f1f5f9,#cbd5e1', noFocus: false },
  blue:    { activeColor: '#e0f2fe', gap: 10, speed: 25, colors: '#e0f2fe,#7dd3fc,#0ea5e9', noFocus: false },
  yellow:  { activeColor: '#fef08a', gap: 3,  speed: 20, colors: '#fef08a,#fde047,#eab308', noFocus: false },
  pink:    { activeColor: '#fecdd3', gap: 6,  speed: 80, colors: '#fecdd3,#fda4af,#e11d48', noFocus: true },
  cyan:    { activeColor: '#cffafe', gap: 6,  speed: 40, colors: '#cffafe,#67e8f9,#0891b2', noFocus: false },
  orange:  { activeColor: '#fed7aa', gap: 6,  speed: 50, colors: '#fed7aa,#fb923c,#ea580c', noFocus: false },
  purple:  { activeColor: '#e9d5ff', gap: 6,  speed: 60, colors: '#e9d5ff,#c084fc,#9333ea', noFocus: true },
}

export default function PixelCard({
  variant = 'default',
  gap, speed, colors, noFocus,
  className = '',
  children,
}) {
  const containerRef = useRef(null)
  const canvasRef    = useRef(null)
  const pixelsRef    = useRef([])
  const animationRef = useRef(null)
  const timePrevRef  = useRef(performance.now())
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches).current

  const cfg = VARIANTS[variant] || VARIANTS.default
  const finalGap     = gap     ?? cfg.gap
  const finalSpeed   = speed   ?? cfg.speed
  const finalColors  = colors  ?? cfg.colors
  const finalNoFocus = noFocus ?? cfg.noFocus

  const initPixels = () => {
    if (!containerRef.current || !canvasRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const w = Math.floor(rect.width)
    const h = Math.floor(rect.height)
    const ctx = canvasRef.current.getContext('2d')
    canvasRef.current.width  = w
    canvasRef.current.height = h
    const colorsArr = finalColors.split(',')
    const pxs = []
    for (let x = 0; x < w; x += parseInt(finalGap, 10)) {
      for (let y = 0; y < h; y += parseInt(finalGap, 10)) {
        const color = colorsArr[Math.floor(Math.random() * colorsArr.length)]
        const dx = x - w / 2, dy = y - h / 2
        const delay = reducedMotion ? 0 : Math.sqrt(dx * dx + dy * dy)
        pxs.push(new Pixel(canvasRef.current, ctx, x, y, color,
          getEffectiveSpeed(finalSpeed, reducedMotion), delay))
      }
    }
    pixelsRef.current = pxs
  }

  const doAnimate = (fnName) => {
    animationRef.current = requestAnimationFrame(() => doAnimate(fnName))
    const now = performance.now()
    const passed = now - timePrevRef.current
    if (passed < 1000 / 60) return
    timePrevRef.current = now - (passed % (1000 / 60))
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !canvasRef.current) return
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    let allIdle = true
    for (const px of pixelsRef.current) {
      px[fnName]()
      if (!px.isIdle) allIdle = false
    }
    if (allIdle) cancelAnimationFrame(animationRef.current)
  }

  const handleAnimation = (name) => {
    cancelAnimationFrame(animationRef.current)
    animationRef.current = requestAnimationFrame(() => doAnimate(name))
  }

  useEffect(() => {
    initPixels()
    const ro = new ResizeObserver(initPixels)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => { ro.disconnect(); cancelAnimationFrame(animationRef.current) }
  }, [finalGap, finalSpeed, finalColors])

  return (
    <div
      ref={containerRef}
      className={`pixel-card ${className}`}
      onMouseEnter={() => handleAnimation('appear')}
      onMouseLeave={() => handleAnimation('disappear')}
      onFocus={finalNoFocus ? undefined : (e) => { if (!e.currentTarget.contains(e.relatedTarget)) handleAnimation('appear') }}
      onBlur={finalNoFocus  ? undefined : (e) => { if (!e.currentTarget.contains(e.relatedTarget)) handleAnimation('disappear') }}
      tabIndex={finalNoFocus ? -1 : 0}
    >
      <canvas ref={canvasRef} className="pixel-canvas" />
      {children}
    </div>
  )
}
