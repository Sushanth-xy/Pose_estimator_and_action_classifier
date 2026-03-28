import { useEffect, useRef, useState } from 'react'
import ASCIIText from '../components/ASCIIText'
import styles from './Intro.module.css'

export default function Intro({ onEnter }) {
  const containerRef = useRef(null)
  const videoRef     = useRef(null)
  const [scrollY, setScrollY]   = useState(0)
  const [leaving, setLeaving]   = useState(false)
  const [muted, setMuted]       = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => setScrollY(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Unmute when user scrolls into video section
  useEffect(() => {
    if (scrollY > window.innerHeight * 0.8 && muted && videoRef.current) {
      videoRef.current.muted = false
      videoRef.current.play().catch(() => {})
      setMuted(false)
    }
  }, [scrollY, muted])

  useEffect(() => {
    const threshold = window.innerHeight * 1.75
    if (scrollY > threshold && !leaving) {
      setLeaving(true)
      setTimeout(onEnter, 700)
    }
  }, [scrollY, leaving, onEnter])

  const heroOpacity = Math.max(0, 1 - scrollY / (window.innerHeight * 0.6))
  const heroY       = scrollY * 0.35
  const loadPct     = Math.min(100, Math.max(0,
    ((scrollY - window.innerHeight * 1.5) / (window.innerHeight * 0.4)) * 100
  ))

  return (
    <div ref={containerRef} className={`${styles.container} ${leaving ? styles.leaving : ''}`}>

      {/* ── Section 1: ASCII SQUIRTLE ── */}
      <section className={styles.section}>
        <div className={styles.asciiWrap} style={{ opacity: heroOpacity, transform: `translateY(${heroY}px)` }}>
          <ASCIIText
            text="SQUIRTLE"
            asciiFontSize={8}
            textFontSize={200}
            textColor="#a855f7"
            planeBaseHeight={8}
            enableWaves
          />
        </div>
        <div className={styles.scrollHint} style={{ opacity: heroOpacity }}>
          <span className={styles.scrollText}>SCROLL DOWN</span>
          <div className={styles.scrollArrow} />
        </div>
      </section>

      {/* ── Section 2: Video ── */}
      <section className={styles.videoSection}>
        <div className={styles.videoWrap}>
          <video
            ref={videoRef}
            src="/squirtle-dance.webm"
            autoPlay
            muted
            loop
            playsInline
            className={styles.video}
          />
          {muted && (
            <button
              className={styles.unmuteBtn}
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = false
                  videoRef.current.play().catch(() => {})
                  setMuted(false)
                }
              }}
            >
              TAP FOR SOUND
            </button>
          )}
        </div>
        <div className={styles.scrollHint}>
          <span className={styles.scrollText}>CONTINUE</span>
          <div className={styles.scrollArrow} />
        </div>
      </section>

      {/* ── Section 3: Loading transition ── */}
      <section className={styles.sectionDark}>
        <div className={styles.enterMsg}>
          <span className={styles.enterLabel}>INITIALIZING SYSTEM</span>
          <div className={styles.loadBar}>
            <div className={styles.loadFill} style={{ width: `${loadPct}%` }} />
          </div>
        </div>
      </section>
    </div>
  )
}
