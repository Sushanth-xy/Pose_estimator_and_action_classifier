import { useRef, useEffect, useCallback } from 'react'
import './BorderGlow.css'

export default function BorderGlow({
  children,
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#060010',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1,
  coneSpread = 25,
  animated = false,
  colors = ['#c084fc', '#f472b6', '#38bdf8'],
  className = '',
  style = {},
}) {
  const cardRef = useRef(null)
  const rafRef  = useRef(null)

  // Convert hex colors to CSS custom properties for gradients
  const gradientVars = {
    '--gradient-one':   `radial-gradient(at 80% 55%, ${colors[0] ?? '#c084fc'} 0px, transparent 50%)`,
    '--gradient-two':   `radial-gradient(at 69% 34%, ${colors[1] ?? '#f472b6'} 0px, transparent 50%)`,
    '--gradient-three': `radial-gradient(at 8%  6%,  ${colors[2] ?? '#38bdf8'} 0px, transparent 50%)`,
    '--gradient-base':  `linear-gradient(${colors[0] ?? '#c084fc'} 0 100%)`,
    '--card-bg':        backgroundColor,
    '--border-radius':  `${borderRadius}px`,
    '--glow-padding':   `${glowRadius}px`,
    '--cone-spread':    coneSpread,
    '--edge-sensitivity': edgeSensitivity,
    '--glow-color':     `hsl(${glowColor} / ${glowIntensity * 100}%)`,
    '--glow-color-60':  `hsl(${glowColor} / ${glowIntensity * 60}%)`,
    '--glow-color-50':  `hsl(${glowColor} / ${glowIntensity * 50}%)`,
    '--glow-color-40':  `hsl(${glowColor} / ${glowIntensity * 40}%)`,
    '--glow-color-30':  `hsl(${glowColor} / ${glowIntensity * 30}%)`,
    '--glow-color-20':  `hsl(${glowColor} / ${glowIntensity * 20}%)`,
    '--glow-color-10':  `hsl(${glowColor} / ${glowIntensity * 10}%)`,
  }

  const onMouseMove = useCallback((e) => {
    const card = cardRef.current
    if (!card) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect()
      const cx = rect.left + rect.width  / 2
      const cy = rect.top  + rect.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy

      // Angle from center to cursor (0° = right, goes clockwise)
      const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360

      // Proximity: how close to the edge (0 = center, 100 = edge)
      const normX = Math.abs(e.clientX - rect.left) / rect.width
      const normY = Math.abs(e.clientY - rect.top)  / rect.height
      const edgeDist = Math.min(normX, 1 - normX, normY, 1 - normY)
      const proximity = Math.round((1 - edgeDist * 2) * 100)

      card.style.setProperty('--cursor-angle', `${angle}deg`)
      card.style.setProperty('--edge-proximity', proximity)
    })
  }, [])

  const onMouseLeave = useCallback(() => {
    const card = cardRef.current
    if (!card) return
    card.style.setProperty('--edge-proximity', 0)
  }, [])

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div
      ref={cardRef}
      className={`border-glow-card ${className}`}
      style={{ ...gradientVars, ...style }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div className="edge-light" />
      <div className="border-glow-inner">
        {children}
      </div>
    </div>
  )
}
