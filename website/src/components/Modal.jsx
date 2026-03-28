import { useEffect } from 'react'
import styles from './Modal.module.css'

export default function Modal({ mode, onClose, onLaunch }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        style={{ '--modal-color': mode.accent }}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.tag}>{mode.tag}</span>
          <button className={styles.close} onClick={onClose}>X</button>
        </div>

        <h2 className={styles.title}>{mode.title}</h2>
        <p className={styles.desc}>{mode.desc}</p>

        <div className={styles.featureGrid}>
          {mode.features.map(f => (
            <div key={f} className={styles.featureItem}>
              <span className={styles.featureDot} />
              {f}
            </div>
          ))}
        </div>

        <button className={styles.launch} onClick={() => onLaunch?.(mode)}>
          LAUNCH SYSTEM
        </button>
      </div>
    </div>
  )
}
