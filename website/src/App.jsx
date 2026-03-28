import { useState } from 'react'
import Intro from './pages/Intro'
import Login from './pages/Login'
import Hero from './components/Hero'
import Cards from './components/Cards'
import Modal from './components/Modal'
import Dashboard from './pages/Dashboard'
import DotGrid from './components/DotGrid'

export default function App() {
  const [page, setPage]         = useState('intro')
  const [active, setActive]     = useState(null)
  const [dashMode, setDashMode] = useState(null)

  if (page === 'intro')     return <Intro onEnter={() => setPage('login')} />
  if (page === 'login')     return <Login onLogin={() => setPage('home')} />
  if (page === 'dashboard') return <Dashboard mode={dashMode} onBack={() => setPage('home')} />

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', background: '#000' }}>
      {/* Shared DotGrid background covering Hero + Cards */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <DotGrid
          dotSize={4}
          gap={20}
          baseColor="#2a1a5e"
          activeColor="#c084fc"
          proximity={130}
          shockStrength={6}
          returnDuration={1.5}
        />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <Hero />
        <Cards onSelect={setActive} />
      </div>

      {active && (
        <Modal
          mode={active}
          onClose={() => setActive(null)}
          onLaunch={(mode) => { setActive(null); setDashMode(mode); setPage('dashboard') }}
        />
      )}
    </div>
  )
}
