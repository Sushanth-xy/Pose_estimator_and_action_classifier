import { useState, useRef } from 'react'
import Dock from '../components/Dock'
import PoseAvatarMirror from '../components/PoseAvatarMirror'
import styles from './Dashboard.module.css'

const MODE_LABELS = {
  elderly: 'Elderly Monitoring System',
  baby:    'Baby Monitoring System',
  burglar: 'Burglar Attack Alert',
}
const MODE_COLORS = {
  elderly: '#60a5fa',
  baby:    '#a855f7',
  burglar: '#818cf8',
}

export default function Dashboard({ mode, onBack }) {
  const [source, setSource]         = useState(null)
  const [videoFile, setVideoFile]   = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const videoRef = useRef(null)
  const fileRef  = useRef(null)

  const accent = MODE_COLORS[mode.id] ?? '#7c3aed'

  const startCamera = async () => {
    setSource('camera')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      alert('Camera access denied')
      setSource(null)
    }
  }

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    setSource(null)
    setVideoFile(null)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setVideoFile(URL.createObjectURL(file))
    setSource('video')
  }

  const dockItems = [
    { icon: <span style={{ fontSize: 16, fontWeight: 700 }}>HOME</span>,   label: 'Home',    onClick: () => { stopCamera(); onBack() } },
    { icon: <span style={{ fontSize: 16, fontWeight: 700 }}>CAM</span>,    label: 'Camera',  onClick: startCamera },
    { icon: <span style={{ fontSize: 16, fontWeight: 700 }}>FILE</span>,   label: 'Upload',  onClick: () => fileRef.current?.click() },
    { icon: <span style={{ fontSize: 16, fontWeight: 700 }}>3D</span>,     label: '3D Model', onClick: () => setSidebarOpen(o => !o) },
    { icon: <span style={{ fontSize: 16, fontWeight: 700 }}>STOP</span>,   label: 'Stop',    onClick: stopCamera },
  ]

  return (
    <div className={styles.page} style={{ '--accent': accent }}>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <div>
            <div className={styles.modeLabel}>{MODE_LABELS[mode.id]}</div>
            <div className={styles.modeTag}>{mode.tag}</div>
          </div>
        </div>
        <div className={styles.statusPill}>
          <span className={styles.statusDot} />
          {source === 'camera' ? 'LIVE' : source === 'video' ? 'PLAYBACK' : 'STANDBY'}
        </div>
        {source === 'camera' && (
          <button className={styles.recBtn} onClick={stopCamera}>
            <span className={styles.recDot} /> STOP REC
          </button>
        )}
        {!source && (
          <button className={styles.recBtn} onClick={startCamera}>
            <span className={styles.recDotBlue} /> START REC
          </button>
        )}
      </header>

      <div className={styles.layout}>
        <main className={styles.main}>
          {!source && (
            <div className={styles.placeholder}>
              <p className={styles.placeholderText}>SELECT INPUT SOURCE</p>
              <div className={styles.placeholderActions}>
                <button className={styles.camBtn} onClick={startCamera}>
                  <span className={styles.camDot} />
                  LIVE CAMERA
                </button>
                <button className={styles.sourceBtn} onClick={() => fileRef.current?.click()}>
                  UPLOAD VIDEO
                </button>
              </div>
            </div>
          )}

          {source === 'camera' && (
            <div className={styles.videoWrap}>
              <video ref={videoRef} autoPlay muted className={styles.video} />
              <div className={styles.scanOverlay} />
              <div className={styles.cornerTL} /><div className={styles.cornerTR} />
              <div className={styles.cornerBL} /><div className={styles.cornerBR} />
              <div className={styles.liveTag}>REC</div>
            </div>
          )}

          {source === 'video' && videoFile && (
            <div className={styles.videoWrap}>
              <video src={videoFile} controls className={styles.video} />
              <div className={styles.cornerTL} /><div className={styles.cornerTR} />
              <div className={styles.cornerBL} /><div className={styles.cornerBR} />
            </div>
          )}

          <div className={styles.statsBar}>
            {['Confidence', 'FPS', 'Detections', 'Alerts'].map((label, i) => (
              <div key={label} className={styles.stat}>
                <span className={styles.statVal}>{source ? ['98.2%','30','1','0'][i] : '--'}</span>
                <span className={styles.statLabel}>{label}</span>
              </div>
            ))}
          </div>
        </main>

        {sidebarOpen && (
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <span className={styles.sidebarTitle}>3D POSE MODEL</span>
              <button className={styles.sidebarClose} onClick={() => setSidebarOpen(false)}>X</button>
            </div>
            <div className={styles.modelPlaceholder}>
              <PoseAvatarMirror
                modelPath="/Idle.glb"
                width="100%"
                height="100%"
                confidenceThreshold={0.5}
                smoothing={0.15}
              />
            </div>
          </aside>
        )}
      </div>

      <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
      <Dock items={dockItems} panelHeight={60} baseItemSize={46} magnification={65} />
    </div>
  )
}
