import { useState } from 'react'
import BorderGlow from '../components/BorderGlow'
import Cubes from '../components/Cubes'
import styles from './Login.module.css'

export default function Login({ onLogin }) {
  const [form, setForm]     = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => { setLoading(false); onLogin() }, 800)
  }

  return (
    <div className={styles.page}>
      {/* Cubes background */}
      <div className={styles.cubesBg}>
        <Cubes
          gridSize={10}
          maxAngle={45}
          radius={3}
          borderStyle="1px solid #a855f7"
          faceColor="#000000"
          rippleColor="#c084fc"
          rippleSpeed={1.5}
          autoAnimate
          rippleOnClick
        />
      </div>

      <div className={styles.center}>
        <BorderGlow
          backgroundColor="#08081a"
          borderRadius={20}
          glowColor="270 80 70"
          glowRadius={50}
          glowIntensity={1}
          coneSpread={30}
          edgeSensitivity={25}
          colors={['#7c3aed', '#3b82f6', '#a855f7']}
          style={{ width: 400 }}
        >
          <div className={styles.card}>
            <div className={styles.logo}>
              <span className={styles.logoName}>SQUIRTLE</span>
            </div>
            <p className={styles.sub}>Sign in to access your monitoring system</p>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>EMAIL</label>
                <input
                  type="email"
                  className={styles.input}
                  placeholder="operator@squirtle.ai"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>PASSWORD</label>
                <input
                  type="password"
                  className={styles.input}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                />
              </div>
              <button type="submit" className={styles.btn} disabled={loading}>
                {loading ? 'AUTHENTICATING...' : 'ACCESS SYSTEM'}
              </button>
            </form>
          </div>
        </BorderGlow>
      </div>
    </div>
  )
}
