import styles from './Hero.module.css'

export default function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.vignette} />

      <div className={styles.content}>
        <div className={styles.badge}>
          <span className={styles.dot} />
          SQUIRTLE — AI MONITORING SYSTEM
        </div>

        <h1 className={styles.title}>
          <span className={styles.line}>WATCH.</span>
          <span className={styles.line}>DETECT.</span>
          <span className={styles.lineAccent}>PROTECT.</span>
        </h1>

        <p className={styles.sub}>
          Real-time AI surveillance for the people and places that matter most.
          Built for speed. Engineered for precision.
        </p>

        <div className={styles.stats}>
          <Stat value="99.2%" label="Detection Accuracy" />
          <Stat value="&lt;50ms" label="Response Time" />
          <Stat value="24/7" label="Live Monitoring" />
        </div>
      </div>

      <div className={styles.scrollHint}>
        <span className={styles.scrollText}>SELECT MODE BELOW</span>
        <div className={styles.scrollArrow} />
      </div>
    </section>
  )
}

function Stat({ value, label }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </div>
    </div>
  )
}
