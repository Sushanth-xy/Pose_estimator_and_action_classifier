import { useRef, useEffect, useState, Suspense, Component } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// ─── Angle Calculator ────────────────────────────────────────────────────────
// Computes the angle at point B given three 2D points A, B, C
// Returns degrees in [0, 180]
export function calculateAngle(A, B, C) {
  const BAx = A[0] - B[0]
  const BAy = A[1] - B[1]
  const BCx = C[0] - B[0]
  const BCy = C[1] - B[1]
  const dot = BAx * BCx + BAy * BCy
  const magBA = Math.sqrt(BAx * BAx + BAy * BAy)
  const magBC = Math.sqrt(BCx * BCx + BCy * BCy)
  const denom = magBA * magBC
  if (denom < 1e-8) return 180 // coincident points → treat as straight
  const cosAngle = Math.max(-1, Math.min(1, dot / denom))
  return Math.acos(cosAngle) * (180 / Math.PI)
}

// ─── Coordinate Normalization ─────────────────────────────────────────────────
// Maps pixel coords [0,640] → [0,1], mirrors x, inverts y for Three.js
export function normalizeKeypoints(keypoints) {
  return keypoints.map(([px, py]) => [
    1 - px / 640, // mirror x
    1 - py / 640, // invert y (COCO top=0, Three.js up=positive)
  ])
}

// ─── Bone Mapping Table ───────────────────────────────────────────────────────
// Each entry: [boneName, proximalIdx, middleIdx, distalIdx, axis]
const BONE_MAP = [
  ['mixamorigLeftArm',      11, 5,  7,  'z'],
  ['mixamorigLeftForeArm',   5, 7,  9,  'z'],
  ['mixamorigRightArm',     12, 6,  8,  'z'],
  ['mixamorigRightForeArm',  6, 8, 10,  'z'],
  ['mixamorigLeftUpLeg',     5, 11, 13, 'x'],
  ['mixamorigLeftLeg',      11, 13, 15, 'x'],
  ['mixamorigRightUpLeg',    6, 12, 14, 'x'],
  ['mixamorigRightLeg',     12, 14, 16, 'x'],
]

const _tmpEuler = new THREE.Euler()
const _tmpQuat  = new THREE.Quaternion()

// Applies COCO keypoints to Mixamo bones with lerp smoothing
export function applyPose(bonesRef, keypoints, confidence, confidenceThreshold, smoothing) {
  if (confidence < confidenceThreshold) return
  const kp = normalizeKeypoints(keypoints)

  for (const [boneName, pi, mi, di, axis] of BONE_MAP) {
    const bone = bonesRef.current[boneName]
    if (!bone) continue

    const angleDeg = calculateAngle(kp[pi], kp[mi], kp[di])
    const angleRad = (180 - angleDeg) * (Math.PI / 180)

    _tmpEuler.set(
      axis === 'x' ? angleRad : 0,
      0,
      axis === 'z' ? angleRad : 0
    )
    _tmpQuat.setFromEuler(_tmpEuler)
    bone.quaternion.slerp(_tmpQuat, smoothing)
  }
}

// ─── Demo Animator ────────────────────────────────────────────────────────────
// Drives a looping squat animation using a sine wave when no WS is connected
const _demoEuler = new THREE.Euler()
const _demoQuat  = new THREE.Quaternion()

export function applyDemo(bonesRef, elapsedTime) {
  const squat = Math.sin(elapsedTime * 1.2) * 0.4 // ±0.4 rad ≈ ±23°

  const demoBones = [
    ['mixamorigLeftUpLeg',  'x',  squat],
    ['mixamorigRightUpLeg', 'x',  squat],
    ['mixamorigLeftLeg',    'x', -squat],
    ['mixamorigRightLeg',   'x', -squat],
  ]

  for (const [boneName, axis, angle] of demoBones) {
    const bone = bonesRef.current[boneName]
    if (!bone) continue
    _demoEuler.set(axis === 'x' ? angle : 0, 0, axis === 'z' ? angle : 0)
    _demoQuat.setFromEuler(_demoEuler)
    bone.quaternion.slerp(_demoQuat, 0.1)
  }
}

// ─── useWebSocket Hook ────────────────────────────────────────────────────────
function useWebSocket(url) {
  const keypointsRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const wsRef      = useRef(null)
  const timerRef   = useRef(null)

  useEffect(() => {
    function connect() {
      setStatus('connecting')
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => setStatus('live')

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (!Array.isArray(data.keypoints) || data.keypoints.length !== 17) {
            console.warn('[PoseAvatarMirror] Invalid keypoints length, discarding frame')
            return
          }
          keypointsRef.current = { keypoints: data.keypoints, confidence: data.confidence ?? 1 }
        } catch {
          console.warn('[PoseAvatarMirror] Invalid JSON message, discarding frame')
        }
      }

      ws.onclose = () => {
        setStatus('demo')
        keypointsRef.current = null
        timerRef.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [url])

  return { keypointsRef, status }
}

// ─── AvatarScene ──────────────────────────────────────────────────────────────
function AvatarScene({ modelPath, wsUrl, confidenceThreshold, smoothing, onStatusChange }) {
  const { scene } = useGLTF(modelPath)
  const bonesRef  = useRef({})
  const { keypointsRef, status } = useWebSocket(wsUrl)

  // Populate bone map once after GLB loads
  useEffect(() => {
    bonesRef.current = {}
    scene.traverse((obj) => {
      if (obj.isBone) bonesRef.current[obj.name] = obj
    })
  }, [scene])

  // Notify parent of status changes for the overlay
  useEffect(() => { onStatusChange(status) }, [status, onStatusChange])

  useFrame((state) => {
    if (status === 'live' && keypointsRef.current) {
      const { keypoints, confidence } = keypointsRef.current
      applyPose(bonesRef, keypoints, confidence, confidenceThreshold, smoothing)
    } else {
      applyDemo(bonesRef, state.clock.elapsedTime)
    }
  })

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={1} />
      <primitive object={scene} position={[0, -1, 0]} />
      <OrbitControls enablePan={false} />
    </>
  )
}

// ─── Status Overlay ───────────────────────────────────────────────────────────
const STATUS_LABELS = { connecting: 'Connecting...', live: '🟢 Live', demo: '🟡 Demo Mode' }
const STATUS_COLORS = { connecting: '#aaa', live: '#4ade80', demo: '#facc15' }

function StatusOverlay({ status }) {
  return (
    <div style={{
      position: 'absolute', top: 12, left: 12,
      background: 'rgba(0,0,0,0.55)', borderRadius: 6,
      padding: '4px 10px', color: STATUS_COLORS[status],
      fontFamily: 'monospace', fontSize: 13, pointerEvents: 'none',
    }}>
      {STATUS_LABELS[status] ?? status}
    </div>
  )
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) return (
      <div style={{ color: 'red', padding: 16 }}>
        Failed to load model: {this.state.error.message}
      </div>
    )
    return this.props.children
  }
}

// ─── PoseAvatarMirror (public API) ────────────────────────────────────────────
export default function PoseAvatarMirror({
  wsUrl              = 'ws://localhost:8765',
  modelPath          = '/Idle.glb',
  confidenceThreshold = 0.5,
  smoothing          = 0.15,
  width              = '100%',
  height             = '100%',
}) {
  const [status, setStatus] = useState('connecting')

  return (
    <div style={{ position: 'relative', width, height }}>
      <ErrorBoundary>
        <Suspense fallback={
          <div style={{ color: '#fff', padding: 16, fontFamily: 'monospace' }}>
            Loading model...
          </div>
        }>
          <Canvas camera={{ position: [0, 1, 3], fov: 50 }} style={{ width: '100%', height: '100%' }}>
            <AvatarScene
              modelPath={modelPath}
              wsUrl={wsUrl}
              confidenceThreshold={confidenceThreshold}
              smoothing={smoothing}
              onStatusChange={setStatus}
            />
          </Canvas>
        </Suspense>
      </ErrorBoundary>
      <StatusOverlay status={status} />
    </div>
  )
}

