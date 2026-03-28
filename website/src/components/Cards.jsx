import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import BorderGlow from './BorderGlow'
import PixelCard from './PixelCard'
import styles from './Cards.module.css'

const MODES = [
  {
    id: 'elderly',
    tag: 'CARE MODE',
    title: 'Elderly Monitoring System',
    desc: 'AI-powered fall detection, activity tracking, and emergency alerts for senior safety.',
    features: ['Fall Detection', 'Inactivity Alerts', 'Vitals Tracking', 'Emergency SOS'],
    glowColor: '210 80 70',
    colors: ['#60a5fa', '#3b82f6', '#1d4ed8'],
    accent: '#60a5fa',
    pixelVariant: 'blue',
  },
  {
    id: 'baby',
    tag: 'GUARDIAN MODE',
    title: 'Baby Monitoring System',
    desc: 'Real-time infant surveillance with cry detection, sleep analysis, and posture alerts.',
    features: ['Cry Detection', 'Sleep Analysis', 'Posture Alerts', 'Breathing Monitor'],
    glowColor: '270 80 70',
    colors: ['#a855f7', '#7c3aed', '#6d28d9'],
    accent: '#a855f7',
    pixelVariant: 'purple',
  },
  {
    id: 'burglar',
    tag: 'THREAT MODE',
    title: 'Burglar Attack Alert',
    desc: 'Perimeter breach detection, intruder tracking, and instant security alerts.',
    features: ['Motion Detection', 'Intruder Tracking', 'Zone Alerts', 'Night Vision AI'],
    glowColor: '240 80 70',
    colors: ['#818cf8', '#6366f1', '#4f46e5'],
    accent: '#818cf8',
    pixelVariant: 'default',
  },
]

export default function Cards({ onSelect }) {
  const sectionRef = useRef(null)
  const cardsRef   = useRef([])
  const labelRef   = useRef(null)
  const entered    = useRef(false)

  useEffect(() => {
    const cards = cardsRef.current
    const label = labelRef.current
    if (!cards.length) return

    gsap.set(cards, { y: 80, opacity: 0, scale: 0.93 })
    gsap.set(label, { y: 20, opacity: 0 })

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !entered.current) {
        entered.current = true
        const tl = gsap.timeline()
        tl.to(label, { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' })
        tl.to(cards, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out', stagger: 0.15 }, '-=0.2')
      }
    }, { threshold: 0.2 })

    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className={styles.section}>
      <div ref={labelRef} className={styles.label}>SELECT MONITORING MODE</div>
      <div className={styles.grid}>
        {MODES.map((mode, i) => (
          <div key={mode.id} ref={el => (cardsRef.current[i] = el)}>
            <BorderGlow
              backgroundColor="#08081a"
              borderRadius={20}
              glowColor={mode.glowColor}
              glowRadius={50}
              glowIntensity={1}
              coneSpread={30}
              edgeSensitivity={25}
              colors={mode.colors}
              style={{ cursor: 'pointer', height: '100%' }}
            >
              <PixelCard
                variant={mode.pixelVariant}
                colors={mode.colors.join(',')}
                gap={6}
                speed={50}
                className={styles.pixelOverride}
              >
                <div className={styles.cardInner} style={{ '--accent': mode.accent }} onClick={() => onSelect(mode)}>
                  <div className={styles.cardTag}>{mode.tag}</div>
                  <h2 className={styles.cardTitle}>{mode.title}</h2>
                  <p className={styles.cardDesc}>{mode.desc}</p>
                  <ul className={styles.features}>
                    {mode.features.map(f => (
                      <li key={f} className={styles.feature}>
                        <span className={styles.featureDot} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button className={styles.btn}>ACTIVATE</button>
                </div>
              </PixelCard>
            </BorderGlow>
          </div>
        ))}
      </div>
    </section>
  )
}
