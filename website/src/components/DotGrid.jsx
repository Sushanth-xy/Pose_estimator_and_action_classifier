import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import styles from './DotGrid.module.css'

export default function DotGrid({
  dotSize = 5,
  gap = 15,
  baseColor = '#271E37',
  activeColor = '#5227FF',
  proximity = 120,
  shockRadius = 250,
  shockStrength = 5,
  resistance = 750,
  returnDuration = 1.5,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const dotsRef = useRef([])
  const mouseRef = useRef({ x: -9999, y: -9999 })
  const rafRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')

    function buildGrid() {
      const { width, height } = container.getBoundingClientRect()
      canvas.width = width
      canvas.height = height

      const cols = Math.floor(width / (dotSize + gap))
      const rows = Math.floor(height / (dotSize + gap))
      const padX = (width - cols * (dotSize + gap)) / 2
      const padY = (height - rows * (dotSize + gap)) / 2

      dotsRef.current = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = padX + c * (dotSize + gap) + dotSize / 2
          const y = padY + r * (dotSize + gap) + dotSize / 2
          dotsRef.current.push({ ox: x, oy: y, x, y, vx: 0, vy: 0 })
        }
      }
    }

    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return { r, g, b }
    }

    const base = hexToRgb(baseColor)
    const active = hexToRgb(activeColor)

    function lerpColor(t) {
      const r = Math.round(base.r + (active.r - base.r) * t)
      const g = Math.round(base.g + (active.g - base.g) * t)
      const b = Math.round(base.b + (active.b - base.b) * t)
      return `rgb(${r},${g},${b})`
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const mx = mouseRef.current.x
      const my = mouseRef.current.y

      for (const dot of dotsRef.current) {
        const dx = dot.x - mx
        const dy = dot.y - my
        const dist = Math.sqrt(dx * dx + dy * dy)
        const t = Math.max(0, 1 - dist / proximity)

        ctx.beginPath()
        ctx.arc(dot.x, dot.y, dotSize / 2, 0, Math.PI * 2)
        ctx.fillStyle = lerpColor(t)
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    function onMouseMove(e) {
      const rect = container.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      mouseRef.current = { x: mx, y: my }

      for (const dot of dotsRef.current) {
        const dx = dot.x - mx
        const dy = dot.y - my
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < proximity) {
          const force = (1 - dist / proximity) * shockStrength
          gsap.to(dot, {
            x: dot.ox + (dx / dist) * force * 8,
            y: dot.oy + (dy / dist) * force * 8,
            duration: 0.15,
            ease: 'power2.out',
            overwrite: true,
          })
          gsap.to(dot, {
            x: dot.ox,
            y: dot.oy,
            duration: returnDuration,
            ease: 'elastic.out(1, 0.3)',
            delay: 0.15,
            overwrite: false,
          })
        }
      }
    }

    function onMouseLeave() {
      mouseRef.current = { x: -9999, y: -9999 }
    }

    buildGrid()
    draw()

    container.addEventListener('mousemove', onMouseMove)
    container.addEventListener('mouseleave', onMouseLeave)
    const ro = new ResizeObserver(buildGrid)
    ro.observe(container)

    return () => {
      cancelAnimationFrame(rafRef.current)
      container.removeEventListener('mousemove', onMouseMove)
      container.removeEventListener('mouseleave', onMouseLeave)
      ro.disconnect()
    }
  }, [dotSize, gap, baseColor, activeColor, proximity, shockStrength, returnDuration])

  return (
    <div ref={containerRef} className={styles.dotGrid}>
      <div className={styles.dotGridWrap}>
        <canvas ref={canvasRef} className={styles.dotGridCanvas} />
      </div>
    </div>
  )
}
