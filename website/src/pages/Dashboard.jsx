import { useState, useRef, useEffect } from 'react'
import Dock from '../components/Dock'
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

const FLASK = 'http://localhost:8080'

export default function Dashboard({ mode, onBack }) {
  const [source, setSource]       = useState(null)
  const [alerts, setAlerts]       = useState([])
  const [stats, setStats]         = useState({})
  const [uploading, setUploading] = useState(false)
  const videoRef   = useRef(null)
  const fileRef    = useRef(null)
  const pollRef    = useRef(null)
  const accent = MODE_COLORS[mode.id] ?? '#7c3aed'

  // Poll Flask for alerts + stats
  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const [aRes, sRes] = await Promise.all([
          fetch(`${FLASK}/alerts`),
          fetch(`${FLASK}/stats`),
        ])
        setAlerts(await aRes.json())
        setStats(await sRes.json())
      } catch {}
    }, 1500)
  }

  const stopAll = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setSource(null)
    setAlerts([])
    setStats({})
  }

  useEffect(() => () => stopAll(), [])

  // Upload video to Flask
  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('video', file)
    try {
      const res = await fetch(`${FLASK}/upload`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed')
      setSource('flask')
      setAlerts([])
      startPolling()
    } catch (err) {
      alert('Upload failed: ' + err.message + '\n\nMake sure baby_monitor.py is running.')
    } finally {
      setUploading(false)
    }
  }

  // Browser webcam (no Python)
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (videoRef.current) videoRef.current.srcObject = stream
      setSource('camera')
    } catch { alert('Camera access denied') }
  }

  const dockItems = [
    { icon: <span style={{ fontSize: 14, fontWeight: 700 }}>HOME</span>,  label: 'Home',   onClick: () => { stopAll(); onBack() } },
    { icon: <span style={{ fontSize: 14, fontWeight: 700 }}>CAM</span>,   label: 'Camera', onClick: startCamera },
    { icon: <span style={{ fontSize: 14, fontWeight: 700 }}>FILE</span>,  label: 'Upload', onClick: () => fileRef.current?.click() },
    { icon: <span style={{ fontSize: 14, fontWeight: 700 }}>STOP</span>,  label: 'Stop',   onClick: stopAll },
  ]

  const severityColor = (s) => s === 'critical' ? '#ff4444' : s === 'warning' ? '#ffaa00' : '#7ec8e3'

  return (
    <div className={styles.page} style={{ '--accent': accent }}>
      {/* Top bar */}
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <div className={styles.modeLabel}>{MODE_LABELS[mode.id]}</div>
          <div className={styles.modeTag}>{mode.tag}</div>
        </div>
        <div className={styles.statusPill}>
          <span className={styles.statusDot} />
          {source === 'flask' ? 'PYTHON FEED' : source === 'camera' ? 'LIVE' : 'STANDBY'}
        </div>
        {!source
          ? <button className={styles.recBtn} onClick={startCamera}><span className={styles.recDotBlue} /> START REC</button>
          : <button className={styles.recBtn} onClick={stopAll}><span className={styles.recDot} /> STOP</button>
        }
      </header>

      <div className={styles.layout}>
        {/* Main video area */}
        <main className={styles.main}>
          {!source && (
            <div className={styles.placeholder}>
              <p className={styles.placeholderText}>SELECT INPUT SOURCE</p>
              <div className={styles.placeholderActions}>
                <button className={styles.camBtn} onClick={startCamera}>
                  <span className={styles.camDot} /> LIVE CAMERA
                </button>
                <button
                  className={styles.camBtn}
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', opacity: uploading ? 0.6 : 1 }}
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  <span className={styles.camDot} />
                  {uploading ? 'UPLOADING...' : 'UPLOAD VIDEO (Python)'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: '#5b5b80', marginTop: 12, fontFamily: 'monospace' }}>
                Upload requires baby_monitor.py running on localhost:8080
              </p>
            </div>
          )}

          {source === 'flask' && (
            <div className={styles.videoWrap}>
              <img src={`${FLASK}/video_feed`} alt="Python feed" className={styles.video} />
              <div className={styles.cornerTL} /><div className={styles.cornerTR} />
              <div className={styles.cornerBL} /><div className={styles.cornerBR} />
              <div className={styles.liveTag}>PYTHON MONITOR</div>
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

          {/* Stats bar */}
          <div className={styles.statsBar}>
            {[
              ['Face-down', stats.face_down ?? '--'],
              ['Flips',     stats.flip      ?? '--'],
              ['Stillness', stats.stillness ?? '--'],
              ['Breathing', stats.breathing ?? '--'],
            ].map(([label, val]) => (
              <div key={label} className={styles.stat}>
                <span className={styles.statVal}>{String(val)}</span>
                <span className={styles.statLabel}>{label}</span>
              </div>
            ))}
          </div>
        </main>

        {/* Alert panel */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>ALERTS</span>
            <span style={{ fontSize: 10, color: '#5b5b80', fontFamily: 'monospace' }}>
              {alerts.length} total
            </span>
          </div>
          <div className={styles.alertList}>
            {alerts.length === 0 && (
              <div className={styles.noAlerts}>
                {source === 'flask' ? 'Monitoring...' : 'No active feed'}
              </div>
            )}
            {alerts.map((a, i) => (
              <div key={i} className={styles.alertItem} style={{ borderLeftColor: severityColor(a.severity) }}>
                <div className={styles.alertSeverity} style={{ color: severityColor(a.severity) }}>
                  {a.severity?.toUpperCase()}
                </div>
                <div className={styles.alertMsg}>{a.message}</div>
                <div className={styles.alertTime}>{a.time}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} />
      <Dock items={dockItems} panelHeight={60} baseItemSize={46} magnification={65} />
    </div>
  )
}
