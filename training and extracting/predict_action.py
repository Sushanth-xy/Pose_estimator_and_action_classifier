"""
Action Recognition Inference
==============================
Set VIDEO_PATH below and run:
    python predict_action.py

Requirements:
    pip install ultralytics tensorflow opencv-python numpy scikit-learn joblib
"""

import cv2
import numpy as np
import torch
from ultralytics import YOLO
from tensorflow.keras.models import load_model
from pathlib import Path
import joblib

# ─────────────────────────────────────────
# CONFIG — change these
# ─────────────────────────────────────────
VIDEO_PATH        = "path/to/your/video.mp4"   # <-- change this
LSTM_MODEL_PATH   = "pose_lstm_model.h5"
SCALER_PATH       = "scaler.pkl"
ACTION_NAMES_PATH = "action_names_filtered.npy"
YOLO_MODEL        = "yolov8n-pose.pt"
SEQ_LEN           = 60
SUBSAMPLE         = 5
NUM_SAMPLES       = 5     # evenly spaced clips to sample; increase for longer vids
KP_CONF_THRESH    = 0.5   # skip frames with low keypoint confidence (must match training)
# ─────────────────────────────────────────


def calculate_angle(a, b, c):
    a, b, c = np.array(a), np.array(b), np.array(c)
    radians = (np.arctan2(c[1]-b[1], c[0]-b[0])
             - np.arctan2(a[1]-b[1], a[0]-b[0]))
    angle = np.abs(radians * 180.0 / np.pi)
    if angle > 180.0: angle = 360 - angle
    return angle


def get_body_orientation(kp):
    mid_shoulder = (kp[5] + kp[6]) / 2
    mid_hip      = (kp[11] + kp[12]) / 2
    spine_vec    = mid_shoulder - mid_hip
    return np.degrees(np.arctan2(abs(spine_vec[0]), abs(spine_vec[1]) + 1e-6))


def get_torso_lean(kp):
    mid_shoulder = (kp[5] + kp[6]) / 2
    mid_hip      = (kp[11] + kp[12]) / 2
    spine_vec    = mid_shoulder - mid_hip
    return spine_vec[0] / (abs(spine_vec[1]) + 1e-6)


def get_arm_angles(kp):
    mid_hip      = (kp[11] + kp[12]) / 2
    mid_shoulder = (kp[5]  + kp[6])  / 2
    torso_vec    = mid_hip - mid_shoulder
    l_arm_vec    = kp[7] - kp[5]
    r_arm_vec    = kp[8] - kp[6]
    def vec_angle(v1, v2):
        cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
        return np.degrees(np.arccos(np.clip(cos, -1, 1)))
    return vec_angle(torso_vec, l_arm_vec), vec_angle(torso_vec, r_arm_vec)


def get_hip_knee_alignment(kp):
    hip_width  = np.linalg.norm(kp[11] - kp[12]) + 1e-6
    knee_width = np.linalg.norm(kp[13] - kp[14])
    return knee_width / hip_width


def get_wrist_hip_height(kp, mid_hip):
    return (mid_hip[1] - kp[9][1]), (mid_hip[1] - kp[10][1])


def extract_features_from_frame(kp, prev_kp=None):
    mid_hip = (kp[11] + kp[12]) / 2
    norm_kp = kp - mid_hip

    l_elbow = calculate_angle(kp[5], kp[7], kp[9])
    r_elbow = calculate_angle(kp[6], kp[8], kp[10])
    l_knee  = calculate_angle(kp[11], kp[13], kp[15])
    r_knee  = calculate_angle(kp[12], kp[14], kp[16])

    orientation    = get_body_orientation(kp)
    torso_lean     = get_torso_lean(kp)
    l_abd, r_abd   = get_arm_angles(kp)
    knee_hip_ratio = get_hip_knee_alignment(kp)
    l_wh, r_wh     = get_wrist_hip_height(kp, mid_hip)
    l_ext          = np.linalg.norm(kp[9]  - kp[5])
    r_ext          = np.linalg.norm(kp[10] - kp[6])

    if prev_kp is not None:
        l_wrist_vel = np.linalg.norm(kp[9]  - prev_kp[9])
        r_wrist_vel = np.linalg.norm(kp[10] - prev_kp[10])
        l_ankle_vel = np.linalg.norm(kp[15] - prev_kp[15])
        r_ankle_vel = np.linalg.norm(kp[16] - prev_kp[16])
    else:
        l_wrist_vel = r_wrist_vel = l_ankle_vel = r_ankle_vel = 0.0

    return np.concatenate([
        norm_kp.flatten(),
        [l_elbow, r_elbow, l_knee, r_knee],
        [orientation, torso_lean],
        [l_abd, r_abd],
        [knee_hip_ratio],
        [l_wh, r_wh],
        [l_ext, r_ext],
        [l_wrist_vel, r_wrist_vel, l_ankle_vel, r_ankle_vel],
    ])  # 51 features


def extract_all_features(video_path, yolo_model):
    """Run YOLO on every frame, filter low-confidence, return subsampled features."""
    device = 0 if torch.cuda.is_available() else "cpu"
    cap    = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video: {video_path}")

    raw_features  = []
    prev_kp       = None
    frame_count   = 0
    skipped       = 0

    print("Extracting pose features", end="", flush=True)
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break
        frame_count += 1
        if frame_count % 50 == 0:
            print(".", end="", flush=True)

        results  = yolo_model(frame, verbose=False, device=device)
        kp_data  = results[0].keypoints

        if kp_data is None or len(kp_data.xy) == 0:
            skipped += 1
            continue

        kp   = kp_data.xy[0].cpu().numpy()
        conf = kp_data.conf[0].cpu().numpy()

        if conf.mean() < KP_CONF_THRESH:
            skipped += 1
            continue

        feat = extract_features_from_frame(kp, prev_kp)
        raw_features.append(feat)
        prev_kp = kp

    cap.release()
    print(f"\nFrames: {frame_count} | Pose frames kept: {len(raw_features)} | Skipped: {skipped}")
    return raw_features[::SUBSAMPLE]


def build_samples(filtered_frames):
    """Pull NUM_SAMPLES evenly spaced 60-frame windows from the video."""
    total = len(filtered_frames)

    if total < SEQ_LEN:
        indices  = np.linspace(0, total - 1, SEQ_LEN).astype(int)
        sequence = np.array([filtered_frames[i] for i in indices])
        print(f"Short video: 1 sample (interpolated from {total} frames)")
        return sequence[np.newaxis, ...]

    max_start    = total - SEQ_LEN
    start_points = np.linspace(0, max_start, NUM_SAMPLES).astype(int)
    samples      = [np.array(filtered_frames[s:s + SEQ_LEN]) for s in start_points]
    print(f"Pulled {len(samples)} samples from {total} subsampled frames")
    return np.array(samples)   # (NUM_SAMPLES, SEQ_LEN, 51)


def apply_scaler(X, scaler):
    """Apply saved scaler to (N, SEQ_LEN, 51) array."""
    n, t, f = X.shape
    return scaler.transform(X.reshape(-1, f)).reshape(n, t, f)


def predict():
    print(f"\nVideo      : {VIDEO_PATH}")
    print(f"Model      : {LSTM_MODEL_PATH}")
    print(f"Scaler     : {SCALER_PATH}\n")

    # Load everything
    print("Loading models...")
    yolo         = YOLO(YOLO_MODEL)
    lstm         = load_model(LSTM_MODEL_PATH)
    scaler       = joblib.load(SCALER_PATH)
    action_names = np.load(ACTION_NAMES_PATH)

    # Extract
    filtered_frames = extract_all_features(str(Path(VIDEO_PATH).resolve()), yolo)

    if len(filtered_frames) < 10:
        print("Not enough usable frames to classify.")
        return

    # Build samples → scale → predict
    X          = build_samples(filtered_frames)
    X_scaled   = apply_scaler(X, scaler)
    all_probs  = lstm.predict(X_scaled, verbose=0)

    # Per-sample results
    print("\n--- Per-sample predictions ---")
    for i, probs in enumerate(all_probs):
        pred_idx   = int(np.argmax(probs))
        confidence = float(probs[pred_idx]) * 100
        print(f"  Sample {i+1:>2}: {action_names[pred_idx]:<20} ({confidence:.1f}%)")

    # Average across samples → final answer
    avg_probs  = np.mean(all_probs, axis=0)
    pred_idx   = int(np.argmax(avg_probs))
    confidence = float(avg_probs[pred_idx]) * 100

    print("\n" + "=" * 45)
    print(f"  Final Predicted Action : {action_names[pred_idx]}")
    print(f"  Confidence (avg)       : {confidence:.1f}%")
    print("=" * 45)

    print("\nAll class probabilities:")
    for name, prob in sorted(zip(action_names, avg_probs), key=lambda x: x[1], reverse=True):
        bar = "#" * int(prob * 30)
        print(f"  {name:<20} {prob*100:5.1f}%  {bar}")


if __name__ == "__main__":
    predict()
