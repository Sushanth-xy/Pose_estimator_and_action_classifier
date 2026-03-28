# Requirements Document

## Introduction

A React/Three.js component that mirrors a human's pose in real time onto a 3D Mixamo humanoid avatar. The component receives 17 COCO keypoints from a Python/YOLO backend over WebSocket, maps those keypoints to Mixamo bone rotations, and renders the result using @react-three/fiber. A built-in demo mode animates a squat loop when no WebSocket connection is active, enabling standalone testing.

## Glossary

- **Avatar_Component**: The React component (`PoseAvatarMirror`) that owns the Three.js scene, WebSocket connection, and animation loop.
- **Renderer**: The @react-three/fiber `<Canvas>` that renders the 3D scene.
- **Model_Loader**: The subsystem that loads `avatar.glb` from the `public/` folder using `@react-three/drei`'s `useGLTF`.
- **Bone_Mapper**: The subsystem that converts COCO keypoint coordinates into Mixamo bone quaternion rotations.
- **Angle_Calculator**: The function that computes the angle at a middle joint given three keypoint positions (equivalent to the Python `calculate_angle()` function).
- **WebSocket_Client**: The subsystem that connects to `ws://localhost:8765` and receives pose messages.
- **Demo_Animator**: The subsystem that drives a looping squat animation when no WebSocket connection is active.
- **Pose_Message**: A JSON object with shape `{"keypoints": [[x,y], ...], "confidence": number}` containing 17 COCO keypoints in 640×640 pixel space.
- **COCO_Keypoints**: The 17-point skeleton: 0=nose, 1=left_eye, 2=right_eye, 3=left_ear, 4=right_ear, 5=left_shoulder, 6=right_shoulder, 7=left_elbow, 8=right_elbow, 9=left_wrist, 10=right_wrist, 11=left_hip, 12=right_hip, 13=left_knee, 14=right_knee, 15=left_ankle, 16=right_ankle.
- **Mixamo_Rig**: The bone hierarchy inside `avatar.glb` using standard Mixamo bone names (e.g. `mixamorigLeftArm`, `mixamorigRightForeArm`, etc.).

---

## Requirements

### Requirement 1: Load and Display the 3D Avatar

**User Story:** As a developer, I want the component to load and display the Mixamo GLB model, so that there is a visible humanoid avatar to drive with pose data.

#### Acceptance Criteria

1. THE Model_Loader SHALL load the GLB model (default `Idle.glb`) from the React project's `public/` folder using `useGLTF`.
2. WHEN `avatar.glb` is loading, THE Avatar_Component SHALL display a loading indicator in place of the model.
3. IF `avatar.glb` fails to load, THEN THE Avatar_Component SHALL display a visible error message describing the failure.
4. THE Renderer SHALL render the avatar with ambient and directional lighting sufficient to make the model clearly visible.
5. THE Renderer SHALL render the avatar with a camera positioned to show the full body from head to feet.

---

### Requirement 2: WebSocket Connection and Pose Message Ingestion

**User Story:** As a developer, I want the component to connect to the YOLO backend WebSocket, so that live pose keypoints can drive the avatar in real time.

#### Acceptance Criteria

1. WHEN the Avatar_Component mounts, THE WebSocket_Client SHALL attempt to connect to `ws://localhost:8765`.
2. WHEN a Pose_Message is received, THE WebSocket_Client SHALL parse the JSON and extract the `keypoints` array and `confidence` value.
3. IF a received message is not valid JSON or does not contain a `keypoints` array of length 17, THEN THE WebSocket_Client SHALL discard the message and log a warning to the browser console.
4. WHEN the WebSocket connection closes unexpectedly, THE WebSocket_Client SHALL attempt to reconnect every 3 seconds.
5. WHEN the Avatar_Component unmounts, THE WebSocket_Client SHALL close the WebSocket connection and cancel any pending reconnect timers.
6. THE Avatar_Component SHALL display a visible connection status indicator showing one of: "Connecting", "Live", or "Demo Mode".

---

### Requirement 3: Keypoint-to-Bone Rotation Mapping

**User Story:** As a developer, I want COCO keypoints mapped to Mixamo bone rotations, so that the avatar's limbs reflect the detected human pose.

#### Acceptance Criteria

1. WHEN a valid Pose_Message is received, THE Bone_Mapper SHALL update the rotations of the following Mixamo bones: `mixamorigLeftArm`, `mixamorigLeftForeArm`, `mixamorigRightArm`, `mixamorigRightForeArm`, `mixamorigLeftUpLeg`, `mixamorigLeftLeg`, `mixamorigRightUpLeg`, `mixamorigRightLeg`, `mixamorigLeftFoot`, `mixamorigRightFoot`.
2. THE Angle_Calculator SHALL compute the angle at a middle joint by accepting three (x, y) coordinate pairs — proximal, middle, and distal — and returning the angle in degrees using the law of cosines.
3. THE Bone_Mapper SHALL derive left elbow rotation from COCO keypoints 5 (left_shoulder), 7 (left_elbow), and 9 (left_wrist) via the Angle_Calculator.
4. THE Bone_Mapper SHALL derive right elbow rotation from COCO keypoints 6 (right_shoulder), 8 (right_elbow), and 10 (right_wrist) via the Angle_Calculator.
5. THE Bone_Mapper SHALL derive left knee rotation from COCO keypoints 11 (left_hip), 13 (left_knee), and 15 (left_ankle) via the Angle_Calculator.
6. THE Bone_Mapper SHALL derive right knee rotation from COCO keypoints 12 (right_hip), 14 (right_knee), and 16 (right_ankle) via the Angle_Calculator.
7. THE Bone_Mapper SHALL derive left shoulder rotation from COCO keypoints 11 (left_hip), 5 (left_shoulder), and 7 (left_elbow) via the Angle_Calculator.
8. THE Bone_Mapper SHALL derive right shoulder rotation from COCO keypoints 12 (right_hip), 6 (right_shoulder), and 8 (right_elbow) via the Angle_Calculator.
9. THE Bone_Mapper SHALL derive left hip rotation from COCO keypoints 5 (left_shoulder), 11 (left_hip), and 13 (left_knee) via the Angle_Calculator.
10. THE Bone_Mapper SHALL derive right hip rotation from COCO keypoints 6 (right_shoulder), 12 (right_hip), and 14 (right_knee) via the Angle_Calculator.
11. THE Bone_Mapper SHALL convert computed angles to Three.js `Euler` rotations and apply them to the corresponding Mixamo bones as quaternions.
12. THE Bone_Mapper SHALL normalize input keypoint coordinates from 640×640 pixel space to the range [0, 1] before computing angles.

---

### Requirement 4: Demo / Mock A
WebSocket_Client establishes a connection, THE Demo_Animator SHALL stop and yield control to the Bone_Mapper.
4. WHEN the WebSocket_Client loses its connection, THE Demo_Animator SHALL resume the squat loop animation.
5. THE Demo_Animator SHALL use `requestAnimationFrame` (via the @react-three/fiber `useFrame` hook) to drive animation updates.

---

### Requirement 8: Bone Rotation Smoothing

**User Story:** As a user watching the avatar, I want the avatar's movements to appear fluid rather than jittery, so that the mirroring feels natural even when YOLO keypoints fluctuate between frames.

#### Acceptance Criteria

1. THE Bone_Mapper SHALL interpolate each bone's rotation toward the target angle each frame using linear interpolation (lerp) with a smoothing factor rather than snapping directly to the target.
2. THE smoothing factor SHALL default to `0.15` (i.e. each frame moves 15% of the remaining distance to the target).
3. THE Avatar_Component SHALL expose a `smoothing` prop (number between 0 and 1, default `0.15`) that overrides the smoothing factor used by the Bone_Mapper.
4. WHEN `smoothing` is set to `1.0`, THE Bone_Mapper SHALL snap directly to the target rotation with no interpolation.
5. THE smoothing interpolation SHALL be applied per-bone independently, so different limbs do not affect each other's transition speed.

---

### Requirement 5: Coordinate System and Mirroring

**User Story:** As a developer, I want the avatar to mirror the human's movements correctly, so that the visualization feels natural and intuitive.

#### Acceptance Criteria

1. THE Bone_Mapper SHALL mirror the horizontal axis so that the avatar's left side corresponds to the human's left side as seen from the front (i.e. invert the x-axis mapping).
2. THE Bone_Mapper SHALL map the COCO y-axis (top = 0, bottom = 640) to the Three.js y-axis (up = positive) by inverting the y coordinate.

---

### Requirement 6: Confidence Filtering

**User Story:** As a developer, I want low-confidence poses to be ignored, so that noisy detections do not cause erratic avatar movement.

#### Acceptance Criteria

1. WHEN a Pose_Message is received with a `confidence` value below 0.5, THE Bone_Mapper SHALL not update any bone rotations and SHALL retain the previous pose.
2. THE Avatar_Component SHALL expose a `confidenceThreshold` prop (default `0.5`) that overrides the minimum confidence value used by the Bone_Mapper.

---

### Requirement 7: Component API and Integration

**User Story:** As a developer integrating this component into the team's frontend, I want a clean, self-contained component API, so that I can drop it into the layout without coupling to internal implementation details.

#### Acceptance Criteria

1. THE Avatar_Component SHALL be exported as a default React component named `PoseAvatarMirror`.
2. THE Avatar_Component SHALL accept the following optional props: `wsUrl` (string, default `"ws://localhost:8765"`), `modelPath` (string, default `"/avatar.glb"`), `confidenceThreshold` (number, default `0.5`), and `width`/`height` (number, default `"100%"`).
3. THE Avatar_Component SHALL be fully self-contained: it SHALL manage its own WebSocket connection, Three.js scene, and animation loop internally.
4. THE Renderer SHALL fill the dimensions specified by the `width` and `height` props without overflowing its container.
