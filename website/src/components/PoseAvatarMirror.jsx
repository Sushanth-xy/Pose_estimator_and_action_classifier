import { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { Pose } from 'kalidokit'

function rigRotation(bone, rotation = { x: 0, y: 0, z: 0 }, dampener = 1, lerpAmount = 0.3) {
  if (!bone || !rotation) return
  bone.quaternion.slerp(
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation.x * dampener, rotation.y * dampener, rotation.z * dampener, 'XYZ')
    ), lerpAmount
  )
}

export default function PoseAvatarMirror({ videoRef, modelPath = '/Idle.glb', width = '100%', height = '100%' }) {
  const mountRef = useRef(null)
  const [status, setStatus] = useState('Loading...')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer, controls, rafId, detector, ro
    let cancelled = false
    let modelLoaded = false
    const bones = {}
    const clock = new THREE.Clock()
    let lastLm = null

    // Delay init so DOM has painted and mount has real dimensions
    const initTimer = setTimeout(() => {
      const W = mount.offsetWidth  || 280
      const H = mount.offsetHeight || 400

      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setClearColor(0x050510)
      renderer.setSize(W, H)
      mount.appendChild(renderer.domElement)

      const scene  = new THREE.Scene()
      scene.background = new THREE.Color(0x050510)

      const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
      camera.position.set(0, 0, 3)
      scene.add(new THREE.AmbientLight(0xffffff, 1.5))
      const dir = new THREE.DirectionalLight(0xffffff, 2)
      dir.position.set(2, 4, 2)
      scene.add(dir)

      controls = new OrbitControls(camera, renderer.domElement)
      controls.enablePan = false
      controls.target.set(0, 0, 0)

      // Load GLB
      new GLTFLoader().load(
        modelPath,
        (gltf) => {
          gltf.scene.traverse(obj => {
            // Grab bones from SkinnedMesh skeleton
            if (obj.isSkinnedMesh && obj.skeleton) {
              obj.skeleton.bones.forEach(b => { bones[b.name] = b })
            }
          })
          console.log('Bones from skeleton:', Object.keys(bones))

          // Auto-fit model in view
          const box = new THREE.Box3().setFromObject(gltf.scene)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          const scale = 2 / Math.max(size.x, size.y, size.z)
          gltf.scene.scale.setScalar(scale)
          gltf.scene.position.sub(center.multiplyScalar(scale))

          scene.add(gltf.scene)
          modelLoaded = true
          setStatus(Object.keys(bones).length > 0 ? 'Demo Mode' : 'No skeleton')
        },
        undefined,
        (err) => { console.error('GLB error:', err); setStatus('GLB error') }
      )

      // MediaPipe
      async function initMP() {
        try {
          const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
          )
          detector = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: '/pose_landmarker_heavy.task', delegate: 'GPU' },
            runningMode: 'VIDEO', numPoses: 1,
          })
        } catch (e) { console.warn('MediaPipe init failed:', e) }
      }

      function demoAnimate(t) {
        const s = Math.sin(t * 1.2) * 0.4
        // Try both naming conventions
        const boneNames = [
          ['mixamorigLeftUpLeg',  'mixamorigLeftUpLeg',  s],
          ['mixamorigRightUpLeg', 'mixamorigRightUpLeg', s],
          ['mixamorigLeftLeg',    'mixamorigLeftLeg',    -s],
          ['mixamorigRightLeg',   'mixamorigRightLeg',   -s],
          // Also try arm wave
          ['mixamorigLeftArm',    'mixamorigLeftArm',    Math.sin(t * 0.8) * 0.3],
          ['mixamorigRightArm',   'mixamorigRightArm',   -Math.sin(t * 0.8) * 0.3],
        ]
        for (const [name, , angle] of boneNames) {
          const bone = bones[name]
          if (bone) {
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(angle, 0, 0))
            bone.quaternion.slerp(q, 0.1)
          }
        }
        // Log bone names once
        if (!window._boneNamesLogged && Object.keys(bones).length > 0) {
          console.log('Available bones:', Object.keys(bones).filter(n => n.includes('mixamorig')))
          window._boneNamesLogged = true
        }
      }

      function rigFromLandmarks(lm) {
        try {
          const video = videoRef?.current
          const kp = lm.map(p => ({ x: p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 }))
          const rig = Pose.solve(kp, kp, {
            runtime: 'mediapipe',
            video,
            imageSize: { width: video?.videoWidth || 640, height: video?.videoHeight || 480 },
            smoothLandmarks: true,
          })
          if (!rig) return
          rigRotation(bones['mixamorigHips'],         rig.Hips?.rotation,  0.7)
          rigRotation(bones['mixamorigSpine'],         rig.Spine,           0.7)
          rigRotation(bones['mixamorigLeftArm'],       rig.LeftUpperArm,    1)
          rigRotation(bones['mixamorigRightArm'],      rig.RightUpperArm,   1)
          rigRotation(bones['mixamorigLeftForeArm'],   rig.LeftLowerArm,    1)
          rigRotation(bones['mixamorigRightForeArm'],  rig.RightLowerArm,   1)
          rigRotation(bones['mixamorigLeftUpLeg'],     rig.LeftUpperLeg,    1)
          rigRotation(bones['mixamorigRightUpLeg'],    rig.RightUpperLeg,   1)
          rigRotation(bones['mixamorigLeftLeg'],       rig.LeftLowerLeg,    1)
          rigRotation(bones['mixamorigRightLeg'],      rig.RightLowerLeg,   1)
        } catch (e) { console.warn('rig error:', e) }
      }

      function animate() {
        if (cancelled) return
        rafId = requestAnimationFrame(animate)
        const t = clock.getElapsedTime()
        const video = videoRef?.current
        if (detector && video && video.readyState >= 2) {
          try {
            const res = detector.detectForVideo(video, performance.now())
            lastLm = res.landmarks?.[0] ?? null
            setStatus(lastLm ? 'Live' : 'Demo Mode')
          } catch {}
        }
        if (modelLoaded) {
          if (lastLm) rigFromLandmarks(lastLm)
          else demoAnimate(t)
        }
        controls.update()
        renderer.render(scene, camera)
      }

      initMP().then(() => animate())

      ro = new ResizeObserver(() => {
        const w = mount.offsetWidth, h = mount.offsetHeight
        if (w && h) {
          renderer.setSize(w, h)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
      })
      ro.observe(mount)
    }, 100) // 100ms delay so DOM is painted

    return () => {
      cancelled = true
      clearTimeout(initTimer)
      cancelAnimationFrame(rafId)
      ro?.disconnect()
      detector?.close()
      if (renderer) {
        renderer.dispose()
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      }
    }
  }, [modelPath, videoRef])

  return (
    <div style={{ position: 'relative', width, height }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%', minHeight: '400px' }} />
      <div style={{
        position: 'absolute', top: 8, left: 8,
        background: 'rgba(0,0,0,0.7)', borderRadius: 6,
        padding: '3px 8px', pointerEvents: 'none',
        color: status === 'Live' ? '#4ade80' : '#a855f7',
        fontFamily: 'monospace', fontSize: 11,
      }}>{status}</div>
    </div>
  )
}
