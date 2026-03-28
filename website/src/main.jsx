import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ClickSpark from './components/ClickSpark'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a0f' }}>
      <ClickSpark
        sparkColor="#a855f7"
        sparkSize={12}
        sparkRadius={20}
        sparkCount={8}
        duration={500}
        extraScale={1.2}
      >
        <App />
      </ClickSpark>
    </div>
  </React.StrictMode>
)
