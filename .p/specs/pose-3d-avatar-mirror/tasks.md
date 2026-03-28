# Implementation Plan: pose-3d-avatar-mirror

## Overview

Build `PoseAvatarMirror` as a single self-contained JSX file at `frontend/src/PoseAvatarMirror.jsx`. Tasks progress from pure utility functions → hooks → scene component → root component → tests.

## Tasks

- [x] 1. Implement `calculateAngle` pure function
  - Create `frontend/src/PoseAvatarMirror.jsx` with the `calculateAngle(A, B, C)` function using the law of cosines
  - Guard against zero-length vectors (return 180 when `|BA| * |BC| < ε`)
  - _Requirements: 3.2_

  - [ ]* 1.1 Write property tests for `calculateAngle`
    - **Property 3: Angle in [0°,180°], collinear=180°, perpendicular=90°**
    - **Validates: Requirements 3.2**
    - Create `frontend/src/__tests__/PoseAvatarMirror.pbt.test.js` with fast-check arbitraries for three 2D points

- [x] 2. Implement coordinate normalization and mirroring helpers
  - Add `normalizeKeypoints(keypoints)` that maps each `[px, py]` from 640×640 space: `x = 1 - px/640`, `y = 1 - py/640`
  - _Requirements: 3.12, 5.1, 5.2_

  - [ ]* 2.1 Write property test for coordinate transform
    - **Property 5: `x_out = 1 - px/640`, `y_out = 1 - py/640`, both in [0,1]**
    - **Validates: Requirements 3.12, 5.1, 5.2**

- [x] 3. Implement `applyPose` (Bone_Mapper)
  - Add `applyPose(bonesRef, keypoints, confidence, confidenceThreshold, smoothing)` using the bone mapping table from the design
  - Bail early when `confidence < confidenceThreshold`
  - For each of the 8 bones: call `calculateAngle`, convert to `THREE.Euler`, slerp bone quaternion by `smoothing`
  - _Requirements: 3.1, 3.3–3.11, 6.1, 8.1–8.5_

  - [ ]* 3.1 Write property test — all 8 bones updated on valid frame
    - **Property 4: Every bone in the mapping table has its quaternion updated**
    - **Validates: Requirements 3.1, 3.3–3.11**

  - [ ]* 3.2 Write property test — confidence filter blocks updates
    - **Property 6: Low-confidence frames leave all bone quaternions unchanged**
    - **Validates: Requirements 6.1**

  - [ ]* 3.3 Write property test — smoothing moves toward target
    - **Property 7: One slerp step is strictly closer to target; s=1 snaps exactly**
    - **Validates: Requirements 8.1, 8.4**

  - [ ]* 3.4 Write property test — per-bone smoothing independence
    - **Property 8: Updating one bone does not change any other bone's quaternion**
    - **Validates: Requirements 8.5**

- [x] 4. Implement `applyDemo` (Demo_Animator)
  - Add `applyDemo(bonesRef, elapsedTime)` using `Math.sin(elapsedTime * 1.2) * 0.4` for hip and knee bones
  - _Requirements: 4.1, 4.2, 4.5_

  - [ ]* 4.1 Write property test — demo output bounded by ±0.4 rad
    - **Property 9: For any elapsed time t, hip/knee rotations lie within [-0.4, 0.4]**
    - **Validates: Requirements 4.2**

- [x] 5. Implement `useWebSocket` hook
  - Add `useWebSocket(url)` returning `{ keypointsRef, status }`
  - Connect on mount to `url`; set status `"connecting"` → `"live"` on open → `"demo"` on close
  - Parse incoming JSON; validate `keypoints.length === 17`; discard and `console.warn` on invalid messages
  - Schedule reconnect after 3 s on unexpected close; clear timer and call `ws.close()` on unmount
  - _Requirements: 2.1–2.6_

  - [ ]* 5.1 Write property tests — valid messages always parsed
    - **Property 1: Any JSON with 17 [x,y] pairs and numeric confidence is stored in keypointsRef**
    - **Validates: Requirements 2.2**

  - [ ]* 5.2 Write property tests — invalid messages always discarded
    - **Property 2: Non-JSON or wrong-length keypoints never update keypointsRef**
    - **Validates: Requirements 2.3**

- [ ] 6. Checkpoint — pure logic complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement `AvatarScene` (r3f scene component)
  - Add `AvatarScene` component inside the same file
  - Use `useGLTF(modelPath)` to load the GLB; traverse scene to populate `bonesRef` in a `useEffect`
  - Wire `useWebSocket` and drive `useFrame`: call `applyPose` when `status === "live"`, else `applyDemo`
  - Add `<ambientLight>` and `<directionalLight>` for clear visibility
  - Position camera to show full body (e.g. `position={[0, 1, 3]}` with `fov={50}`)
  - _Requirements: 1.1, 1.4, 1.5, 3.1, 4.3–4.5_

- [x] 8. Implement `PoseAvatarMirror` root component and status overlay
  - Add default-exported `PoseAvatarMirror` component accepting props: `wsUrl`, `modelPath`, `confidenceThreshold`, `smoothing`, `width`, `height`
  - Wrap `AvatarScene` in `<Canvas>` sized to `width × height`
  - Wrap model in `<Suspense fallback={<LoadingIndicator />}>` and an error boundary rendering `<ErrorFallback>`
  - Render absolute-positioned status overlay showing "Connecting" / "Live" / "Demo Mode"
  - _Requirements: 1.2, 1.3, 2.6, 7.1–7.4_

- [x] 9. Checkpoint — visual integration
  - Update `frontend/src/main.ts` (or create a `.jsx` entry) to mount `<PoseAvatarMirror />` so the component renders in the browser
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Write unit tests
  - Create `frontend/src/__tests__/PoseAvatarMirror.unit.test.jsx`
  - Mock `useGLTF`, `@react-three/fiber` Canvas, and a mock WebSocket class
  - Cover: loading indicator while GLB loads, error fallback on load failure, status overlay text transitions, WebSocket URL on mount, `ws.close()` on unmount, reconnect timer after 3 s, prop defaults, `confidenceThreshold` and `smoothing` props passed through, Canvas sizing
  - _Requirements: 1.2, 1.3, 2.1, 2.4, 2.5, 2.6, 7.2–7.4, 8.2, 8.3_

- [ ] 11. Final checkpoint — all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster hackathon MVP
- Install fast-check before running PBT tasks: `npm install --save-dev fast-check` (run in `frontend/`)
- Run tests with: `npx vitest --run` (from `frontend/`)
- Property tests must include the comment tag `// Feature: pose-3d-avatar-mirror, Property N: <text>`

