import cv2
import numpy as np
import torch
from ultralytics import YOLO
from pathlib import Path
from tqdm.auto import tqdm

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
device         = 0 if torch.cuda.is_available() else 'cpu'
model          = YOLO('yolov8n-pose.pt')
DATA_DIR       = Path('./data/UCF-101')
SEQ_LEN        = 60
SUBSAMPLE      = 5     # every 5th frame
MAX_VIDEOS     = 40
target_actions = ['BodyWeightSquats', 'PushUps', 'PullUps', 'Lunges', 'BenchPress', 'JumpingJack']
# ─────────────────────────────────────────


def calculate_angle(a, b, c):
    """Angle at point B given A, B, C."""
    a, b, c = np.array(a), np.array(b), np.array(c)
    radians = np.arctan2(c[1]-b[1], c[0]-b[0]) - np.arctan2(a[1]-b[1], a[0]-b[0])
    angle = np.abs(radians * 180.0 / np.pi)
    if angle > 180.0: angle = 360 - angle
    return angle


def get_body_orientation(kp):
    """
    Estimate whether body is vertical, horizontal, or in between.
    Uses the vector from mid-hip to mid-shoulder.
    Returns angle from vertical (0=upright, 90=horizontal).
    """
    mid_shoulder = (kp[5] + kp[6]) / 2
    mid_hip      = (kp[11] + kp[12]) / 2
    spine_vec    = mid_shoulder - mid_hip  # points upward when standing

    # Angle from vertical axis (y-axis points down in image coords)
    angle_from_vertical = np.degrees(np.arctan2(abs(spine_vec[0]), abs(spine_vec[1]) + 1e-6))
    return angle_from_vertical  # ~0 = standing, ~90 = lying down


def get_torso_lean(kp):
    """
    Forward/backward lean of torso.
    Positive = leaning forward (squat, pushup), Negative = leaning back.
    """
    mid_shoulder = (kp[5] + kp[6]) / 2
    mid_hip      = (kp[11] + kp[12]) / 2
    spine_vec    = mid_shoulder - mid_hip
    # x-component relative to y-component gives lean
    lean = spine_vec[0] / (abs(spine_vec[1]) + 1e-6)
    return lean


def get_arm_angles(kp):
    """
    Shoulder abduction: angle between upper arm and torso side.
    Detects arms-raised (JumpingJack, PullUp) vs arms-down.
    """
    mid_hip      = (kp[11] + kp[12]) / 2
    mid_shoulder = (kp[5]  + kp[6])  / 2

    # Left arm relative to torso
    torso_vec  = mid_hip - mid_shoulder  # pointing down
    l_arm_vec  = kp[7] - kp[5]          # shoulder to elbow
    r_arm_vec  = kp[8] - kp[6]

    def vec_angle(v1, v2):
        cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
        return np.degrees(np.arccos(np.clip(cos, -1, 1)))

    l_abduction = vec_angle(torso_vec, l_arm_vec)
    r_abduction = vec_angle(torso_vec, r_arm_vec)
    return l_abduction, r_abduction


def get_hip_knee_alignment(kp):
    """
    Hip width vs knee width ratio.
    Helps distinguish squats/lunges (knees spread) vs pushups (knees together).
    """
    hip_width  = np.linalg.norm(kp[11] - kp[12]) + 1e-6
    knee_width = np.linalg.norm(kp[13] - kp[14])
    return knee_width / hip_width


def get_wrist_hip_height(kp, mid_hip):
    """
    Relative wrist height vs hip.
    Negative = wrists below hip (pushup/benchpress on ground),
    Positive = wrists above hip (pullup, jumpingjack overhead).
    """
    l_wrist_rel = (mid_hip[1] - kp[9][1])   # positive if wrist above hip (y flipped in image)
    r_wrist_rel = (mid_hip[1] - kp[10][1])
    return l_wrist_rel, r_wrist_rel


def extract_features_from_frame(kp, prev_kp=None):
    """
    Build full feature vector from keypoints.

    Feature breakdown (total = 38 base + 13 new = 51 features):
      - 34  : normalized x,y for 17 keypoints (relative to mid-hip)
      -  4  : joint angles — l/r elbow, l/r knee
      -  1  : body orientation (angle from vertical — key for BenchPress)
      -  1  : torso lean (forward/back)
      -  2  : shoulder abduction l/r (arms raised vs down)
      -  1  : knee/hip width ratio
      -  2  : wrist height relative to hip l/r
      -  2  : wrist-to-shoulder distance l/r (arm extension)
      -  4  : motion velocity for wrists + ankles (0 if no prev frame)
    """
    mid_hip = (kp[11] + kp[12]) / 2
    norm_kp = kp - mid_hip  # (17, 2) normalized

    # --- Joint angles ---
    l_elbow = calculate_angle(kp[5], kp[7], kp[9])
    r_elbow = calculate_angle(kp[6], kp[8], kp[10])
    l_knee  = calculate_angle(kp[11], kp[13], kp[15])
    r_knee  = calculate_angle(kp[12], kp[14], kp[16])

    # --- Body orientation ---
    orientation = get_body_orientation(kp)
    torso_lean  = get_torso_lean(kp)

    # --- Arm angles ---
    l_abduction, r_abduction = get_arm_angles(kp)

    # --- Knee/hip ratio ---
    knee_hip_ratio = get_hip_knee_alignment(kp)

    # --- Wrist heights ---
    l_wrist_h, r_wrist_h = get_wrist_hip_height(kp, mid_hip)

    # --- Wrist-to-shoulder distance (arm extension) ---
    l_arm_ext = np.linalg.norm(kp[9]  - kp[5])   # left  wrist to shoulder
    r_arm_ext = np.linalg.norm(kp[10] - kp[6])   # right wrist to shoulder

    # --- Motion velocity (wrists + ankles) ---
    if prev_kp is not None:
        l_wrist_vel = np.linalg.norm(kp[9]  - prev_kp[9])
        r_wrist_vel = np.linalg.norm(kp[10] - prev_kp[10])
        l_ankle_vel = np.linalg.norm(kp[15] - prev_kp[15])
        r_ankle_vel = np.linalg.norm(kp[16] - prev_kp[16])
    else:
        l_wrist_vel = r_wrist_vel = l_ankle_vel = r_ankle_vel = 0.0

    feat = np.concatenate([
        norm_kp.flatten(),                                           # 34
        [l_elbow, r_elbow, l_knee, r_knee],                         #  4
        [orientation, torso_lean],                                   #  2
        [l_abduction, r_abduction],                                  #  2
        [knee_hip_ratio],                                            #  1
        [l_wrist_h, r_wrist_h],                                     #  2
        [l_arm_ext, r_arm_ext],                                      #  2
        [l_wrist_vel, r_wrist_vel, l_ankle_vel, r_ankle_vel],        #  4
    ])  # total = 51

    return feat


# ── Main extraction loop ───────────────────────────────────────────
X_data   = []
y_labels = []

print(f"Processing actions: {target_actions}")
print(f"Features per frame: 51  |  SEQ_LEN: {SEQ_LEN}  |  Subsample: every {SUBSAMPLE}th frame\n")

for idx, action in enumerate(target_actions):
    action_path = DATA_DIR / action
    if not action_path.exists():
        print(f"⚠️  Folder {action} not found. Skipping...")
        continue

    video_paths = list(action_path.glob('*.avi')) + list(action_path.glob('*.mp4'))
    print(f"\n🎬 Processing {action} ({len(video_paths)} videos)")

    for v_path in tqdm(video_paths[:MAX_VIDEOS]):
        cap = cv2.VideoCapture(str(v_path))
        raw_features = []
        prev_kp      = None

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break

            results = model(frame, verbose=False, device=device)

            if results[0].keypoints is not None and len(results[0].keypoints.xy) > 0:
                kp   = results[0].keypoints.xy[0].cpu().numpy()
                feat = extract_features_from_frame(kp, prev_kp)
                raw_features.append(feat)
                prev_kp = kp  # save for velocity next frame

        cap.release()

        # Subsample every 5th frame
        filtered = raw_features[::SUBSAMPLE]

        if len(filtered) > 10:
            indices    = np.linspace(0, len(filtered) - 1, SEQ_LEN).astype(int)
            sampled_seq = [filtered[i] for i in indices]
            X_data.append(sampled_seq)
            y_labels.append(idx)

X_arr = np.array(X_data)
y_arr = np.array(y_labels)

np.save('X_train_enhanced.npy',      X_arr)
np.save('y_train_enhanced.npy',      y_arr)
np.save('action_names_filtered.npy', np.array(target_actions))

print(f"\n✅ Extraction Complete!")
print(f"   Shape : {X_arr.shape}  →  (samples, {SEQ_LEN} frames, 51 features)")
print(f"   Samples/class: { {target_actions[i]: int((y_arr==i).sum()) for i in range(len(target_actions))} }")
