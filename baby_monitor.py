import cv2
import numpy as np
from ultralytics import YOLO
import argparse
import math
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk
from datetime import datetime
from collections import deque
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
import threading
import time
import os

# ──────────────────────────────────────────────
#  Constants
# ──────────────────────────────────────────────
YOLO_POSE_MODEL  = 'yolov8n-pose.pt'
YOLO_SEG_MODEL   = 'yolov8n-seg.pt'
VIDEO_SOURCE     = 'test_video_3.mp4'
CONF_THRESH       = 0.5
EDGE_WARN_DIST    = 60
EDGE_CRIT_DIST    = 25
FACE_DOWN_FRAMES  = 20
FLIP_FRAMES       = 10
STILL_RESET_DIST  = 15
STILL_FRAMES      = 120
HEAD_TILT_FRAMES  = 30
LIMB_EXTEND_ANGLE = 160
LIMB_EXTEND_FRAMES= 30
BREATHING_WINDOW  = 80
BREATHING_FLAT_TH = 2.5
COOLDOWN          = 90
SKELETON_PAIRS    = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (5, 7), (7, 9), (6, 8), (8,10),
    (11,13), (13,15), (12,14), (14,16),
    (5,6), (11,12)
]
SEVERITY_COLOUR   = {
    'info': (0, 230, 100),
    'warning': (0, 180, 255),
    'critical': (0, 0, 255),
}

# ──────────────────────────────────────────────
def point_to_polygon_dist(point, polygon):
    min_dist = float('inf')
    n = len(polygon)
    for i in range(n):
        p1 = polygon[i]
        p2 = polygon[(i + 1) % n]
        dx, dy = p2[0] - p1[0], p2[1] - p1[1]
        den = math.hypot(dx, dy)
        if den == 0:
            continue
        num = abs(dy * point[0] - dx * point[1] + p2[0]*p1[1] - p2[1]*p1[0])
        min_dist = min(min_dist, num / den)
    return min_dist

def angle_between(a, b, c):
    ba = (a[0] - b[0], a[1] - b[1])
    bc = (c[0] - b[0], c[1] - b[1])
    dot = ba[0]*bc[0] + ba[1]*bc[1]
    mag = math.hypot(*ba) * math.hypot(*bc)
    if mag == 0:
        return 0.0
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / mag))))

def kp_valid(kps, idx):
    if len(kps) > idx and kps[idx][2] > CONF_THRESH:
        return float(kps[idx][0]), float(kps[idx][1])
    return None

def centroid(kps):
    pts = [(kps[i][0], kps[i][1]) for i in range(len(kps)) if kps[i][2] > CONF_THRESH]
    if not pts:
        return None
    return (float(np.mean([p[0] for p in pts])),
            float(np.mean([p[1] for p in pts])))

# ──────────────────────────────────────────────
#  Per-baby state tracker
# ──────────────────────────────────────────────
class BabyTracker:
    def __init__(self):
        self.face_down_ctr   = 0
        self.flip_ctr        = 0
        self.still_ctr       = 0
        self.head_tilt_ctr   = 0
        self.limb_extend_ctr = 0
        self.baseline_angle  = None
        self.last_centroid   = None
        self.torso_y_history = deque(maxlen=BREATHING_WINDOW)
        self.cooldowns = {}

    def is_cooled_down(self, alert_type):
        return self.cooldowns.get(alert_type, 0) == 0

    def trigger_cooldown(self, alert_type):
        self.cooldowns[alert_type] = COOLDOWN

    def tick_cooldowns(self):
        for k in list(self.cooldowns):
            if self.cooldowns[k] > 0:
                self.cooldowns[k] -= 1

# ──────────────────────────────────────────────
#  Flask API + shared state
# ──────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

class GlobalState:
    def __init__(self):
        self.output_frame = None
        self.lock = threading.Lock()
        self.alerts = []
        self.stats = {
            'face_down': 0, 'flip': 0, 'stillness': 0,
            'head_tilt': 0, 'edge': 0, 'limb': 0, 'breathing': 0,
        }
        self.breathing_status = 'unclear'
        self.video_source = VIDEO_SOURCE  # can be updated via /upload
        self.pending_video_source = None

state = GlobalState()

def generate_frames():
    while True:
        with state.lock:
            if state.output_frame is None:
                continue
            ret, buffer = cv2.imencode('.jpg', state.output_frame)
            frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.03)

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/alerts')
def get_alerts():
    with state.lock:
        return jsonify(state.alerts[-20:])

@app.route('/stats')
def get_stats():
    with state.lock:
        return jsonify({**state.stats, 'breathing': state.breathing_status})

@app.route('/upload', methods=['POST'])
def upload_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    f = request.files['video']
    path = os.path.join('/tmp', f.filename)
    f.save(path)
    with state.lock:
        state.video_source = path
        state.alerts = []
    return jsonify({'status': 'ok', 'path': path})

@app.route('/set_source', methods=['POST'])
def set_source():
    data = request.get_json()
    src = data.get('source', 'camera')
    with state.lock:
        state.video_source = 0 if src == 'camera' else state.video_source
        state.alerts = []
    return jsonify({'status': 'ok'})

@app.route('/upload', methods=['POST'])
def upload_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400
    video_file = request.files['video']
    if video_file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400
    os.makedirs('uploads', exist_ok=True)
    timestamp = int(time.time())
    saved_path = os.path.join('uploads', f'uploaded_{timestamp}_{video_file.filename}')
    video_file.save(saved_path)
    with state.lock:
        state.pending_video_source = saved_path
    return jsonify({'message': 'Upload received, switching source', 'path': saved_path})

@app.route('/set_source', methods=['POST'])
def set_source():
    data = request.get_json(force=True, silent=True)
    if not data or 'source' not in data:
        return jsonify({'error': 'source param required'}), 400
    source = data['source']
    with state.lock:
        if source == 'camera':
            state.pending_video_source = 0
        elif source == 'file':
            return jsonify({'error': 'use /upload to send a file'}), 400
        else:
            return jsonify({'error': 'invalid source'}), 400
    return jsonify({'message': 'Source set to camera'})

# ──────────────────────────────────────────────
#  Main application (Tkinter + AI logic)
# ──────────────────────────────────────────────
class BabyMonitorApp:
    def __init__(self, window=None, title='AI Baby Monitor', video_source=None, use_gui=True):
        self.use_gui = use_gui
        self.video_source = video_source or VIDEO_SOURCE

        if self.use_gui:
            self.window = window or tk.Tk()
            self.window.title(title)
            self.window.configure(bg='#1a1a2e')

        self.pose_model = YOLO(YOLO_POSE_MODEL)
        self.seg_model  = YOLO(YOLO_SEG_MODEL)
        self.cap = cv2.VideoCapture(self.video_source)
        self.vid_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.vid_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps   = self.cap.get(cv2.CAP_PROP_FPS) or 30
        self.crib_roi  = None
        self.setup_mode = False
        self.setup_frame = None
        self.alert_log = []
        self.session_stats = {
            'face_down': 0, 'flip': 0, 'stillness': 0,
            'head_tilt': 0, 'edge': 0, 'limb': 0, 'breathing': 0,
        }
        self.trackers = {}

        if self.use_gui:
            self._build_ui()

        self.auto_detect_crib()
        self.delay = max(1, int(1000 / self.fps))

        if self.use_gui:
            self.update()
            self.window.mainloop()
        else:
            self.no_gui_loop_running = True
            self.no_gui_thread = threading.Thread(target=self._run_headless_loop)
            self.no_gui_thread.daemon = True
            self.no_gui_thread.start()

    def _build_ui(self):
        left = tk.Frame(self.window, bg='#1a1a2e')
        left.pack(side=tk.LEFT, padx=10, pady=10)
        self.canvas = tk.Canvas(left, width=self.vid_w, height=self.vid_h,
                                bg='black', highlightthickness=0)
        self.canvas.pack()
        self.canvas.bind("<Button-1>", self.on_click)
        right = tk.Frame(self.window, bg='#16213e', width=370)
        right.pack(side=tk.RIGHT, fill=tk.Y, padx=10, pady=10)
        right.pack_propagate(False)
        tk.Label(right, text="AI Baby Monitor",
                 font=("Helvetica", 16, "bold"),
                 fg='#e0e0e0', bg='#16213e').pack(pady=(16, 4))
        self.status_label = tk.Label(right, text="INITIALIZING…",
                                     font=("Helvetica", 12, "bold"),
                                     fg='#ffd700', bg='#16213e')
        self.status_label.pack(pady=4)
        brth_frame = tk.Frame(right, bg='#16213e')
        brth_frame.pack(fill=tk.X, padx=12, pady=4)
        tk.Label(brth_frame, text="Breathing rhythm:",
                 font=("Helvetica", 10), fg='#888', bg='#16213e').pack(side=tk.LEFT)
        self.breathing_label = tk.Label(brth_frame, text="—",
                                        font=("Helvetica", 10, "bold"),
                                        fg='#7ec8e3', bg='#16213e')
        self.breathing_label.pack(side=tk.LEFT, padx=6)
        stats_frame = tk.Frame(right, bg='#16213e')
        stats_frame.pack(fill=tk.X, padx=12, pady=8)
        tk.Label(stats_frame, text="Session alerts",
                 font=("Helvetica", 10, "bold"),
                 fg='#aaa', bg='#16213e').grid(row=0, column=0, columnspan=4, sticky='w')
        self._stat_labels = {}
        stat_defs = [
            ('face_down', 'Face-down'), ('flip', 'Flip'),
            ('stillness', 'Still'),     ('head_tilt', 'Head tilt'),
            ('edge', 'Near edge'),      ('limb', 'Limb ext.'),
        ]
        for i, (key, label) in enumerate(stat_defs):
            r, c = divmod(i, 2)
            tk.Label(stats_frame, text=label + ":",
                     font=("Helvetica", 9), fg='#888', bg='#16213e').grid(
                row=r+1, column=c*2, sticky='w', padx=(0, 4))
            lbl = tk.Label(stats_frame, text="0",
                           font=("Helvetica", 9, "bold"),
                           fg='#fff', bg='#16213e')
            lbl.grid(row=r+1, column=c*2+1, sticky='w')
            self._stat_labels[key] = lbl
        tk.Label(right, text="Alert log",
                 font=("Helvetica", 10, "bold"),
                 fg='#aaa', bg='#16213e').pack(anchor='w', padx=12)
        log_frame = tk.Frame(right, bg='#16213e')
        log_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(4, 12))
        self.alert_text = tk.Text(log_frame, height=18, width=40,
                                  font=("Courier", 9),
                                  bg='#0f0f1a', fg='#ccc',
                                  relief=tk.FLAT, bd=0,
                                  state=tk.DISABLED)
        self.alert_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sb = tk.Scrollbar(log_frame, command=self.alert_text.yview)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self.alert_text.configure(yscrollcommand=sb.set)
        self.alert_text.tag_config('critical', foreground='#ff4444')
        self.alert_text.tag_config('warning',  foreground='#ffaa00')
        self.alert_text.tag_config('info',     foreground='#7ec8e3')
        tk.Button(right, text="Clear log",
                  font=("Helvetica", 9),
                  bg='#2a2a4a', fg='#ccc',
                  relief=tk.FLAT, bd=0, padx=8, pady=4,
                  command=self._clear_log).pack(pady=(0, 8))

    def _clear_log(self):
        self.alert_log.clear()
        self.alert_text.configure(state=tk.NORMAL)
        self.alert_text.delete(1.0, tk.END)
        self.alert_text.configure(state=tk.DISABLED)

    def auto_detect_crib(self):
        ret, frame = self.cap.read()
        if not ret:
            return
        results = self.seg_model(frame, verbose=False)
        for result in results:
            if result.masks is not None:
                for i, box in enumerate(result.boxes):
                    if int(box.cls[0]) == 59:
                        mask = result.masks.xy[i]
                        self.crib_roi = np.array(mask, np.int32)
                        self._set_status("ACTIVE", '#00cc66')
                        return
        self.setup_mode  = True
        self.crib_roi    = []
        self.setup_frame = frame.copy()
        self._set_status("Click 4 corners of crib", '#ffaa00')

    def on_click(self, event):
        if not self.setup_mode:
            return
        self.crib_roi.append([event.x, event.y])
        if len(self.crib_roi) == 4:
            self.crib_roi   = np.array(self.crib_roi, np.int32)
            self.setup_mode = False
            self._set_status("ACTIVE", '#00cc66')

    def _set_status(self, text, colour):
        if self.use_gui and hasattr(self, 'status_label'):
            self.status_label.config(text=text, fg=colour)

    def log_alert(self, message, severity, stat_key=None):
        ts = datetime.now().strftime("%H:%M:%S")
        entry = f"[{ts}] [{severity.upper():8}] {message}"
        self.alert_log.insert(0, (entry, severity))
        if len(self.alert_log) > 50:
            self.alert_log.pop()
        if stat_key and stat_key in self.session_stats:
            self.session_stats[stat_key] += 1
            if self.use_gui and hasattr(self, '_stat_labels'):
                self._stat_labels[stat_key].config(text=str(self.session_stats[stat_key]))
        # Push to global state for Flask API
        with state.lock:
            state.alerts.insert(0, {'time': ts, 'message': message, 'severity': severity})
            if len(state.alerts) > 50:
                state.alerts.pop()
            if stat_key:
                state.stats[stat_key] = self.session_stats.get(stat_key, 0)

        if self.use_gui and hasattr(self, 'alert_text'):
            self.alert_text.configure(state=tk.NORMAL)
            self.alert_text.delete(1.0, tk.END)
            for txt, sev in self.alert_log:
                self.alert_text.insert(tk.END, txt + "\n", sev)
            self.alert_text.configure(state=tk.DISABLED)

        if severity == 'critical':
            self._set_status("⚠ ALERT: " + message, '#ff4444')

    def _detect_face_down(self, kps, tracker):
        visible = sum(1 for i in [0,1,2,3,4] if kp_valid(kps, i))
        if visible < 2:
            tracker.face_down_ctr += 1
        else:
            tracker.face_down_ctr = 0
        if tracker.face_down_ctr > FACE_DOWN_FRAMES and tracker.is_cooled_down('face_down'):
            self.log_alert("Face-down position detected!", 'critical', 'face_down')
            tracker.trigger_cooldown('face_down')
            tracker.face_down_ctr = 0
            return True
        return False

    def _detect_flip(self, kps, tracker):
        l = kp_valid(kps, 5)
        r = kp_valid(kps, 6)
        if not (l and r):
            return False
        dx, dy = r[0] - l[0], r[1] - l[1]
        angle  = math.degrees(math.atan2(dy, dx))
        if tracker.baseline_angle is None:
            tracker.baseline_angle = angle
            return False
        diff = abs((angle - tracker.baseline_angle + 180) % 360 - 180)
        if diff > 40:
            tracker.flip_ctr += 1
        else:
            tracker.flip_ctr = 0
        tracker.baseline_angle = 0.9 * tracker.baseline_angle + 0.1 * angle
        if tracker.flip_ctr > FLIP_FRAMES and tracker.is_cooled_down('flip'):
            self.log_alert(f"Baby rolled over! (angle Δ={diff:.0f}°)", 'critical', 'flip')
            tracker.trigger_cooldown('flip')
            tracker.baseline_angle = angle
            tracker.flip_ctr = 0
            return True
        return False

    def _detect_stillness(self, kps, tracker):
        c = centroid(kps)
        if c is None:
            return False
        if tracker.last_centroid is not None:
            dist = math.hypot(c[0] - tracker.last_centroid[0],
                              c[1] - tracker.last_centroid[1])
            if dist > STILL_RESET_DIST:
                tracker.still_ctr = 0
            else:
                tracker.still_ctr += 1
        tracker.last_centroid = c
        if tracker.still_ctr > STILL_FRAMES and tracker.is_cooled_down('stillness'):
            secs = tracker.still_ctr / self.fps
            self.log_alert(f"No movement for {secs:.0f}s", 'warning', 'stillness')
            tracker.trigger_cooldown('stillness')
            return True
        return False

    def _detect_head_tilt(self, kps, tracker):
        nose = kp_valid(kps, 0)
        l    = kp_valid(kps, 5)
        r    = kp_valid(kps, 6)
        if not (nose and l and r):
            return False
        shoulder_mid_x = (l[0] + r[0]) / 2
        shoulder_mid_y = (l[1] + r[1]) / 2
        shoulder_w     = abs(r[0] - l[0]) + 1e-6
        lateral_ratio  = abs(nose[0] - shoulder_mid_x) / shoulder_w
        vertical_ok    = nose[1] < shoulder_mid_y
        if lateral_ratio > 0.6 or not vertical_ok:
            tracker.head_tilt_ctr += 1
        else:
            tracker.head_tilt_ctr = 0
        if tracker.head_tilt_ctr > HEAD_TILT_FRAMES and tracker.is_cooled_down('head_tilt'):
            self.log_alert("Abnormal head tilt detected", 'warning', 'head_tilt')
            tracker.trigger_cooldown('head_tilt')
            tracker.head_tilt_ctr = 0
            return True
        return False

    def _detect_edge_proximity(self, kps, tracker):
        if self.crib_roi is None:
            return False
        l = kp_valid(kps, 5)
        r = kp_valid(kps, 6)
        if not (l and r):
            return False
        cx = (l[0] + r[0]) / 2
        cy = (l[1] + r[1]) / 2
        dist = point_to_polygon_dist((cx, cy), self.crib_roi)
        if dist < EDGE_CRIT_DIST and tracker.is_cooled_down('edge_crit'):
            self.log_alert(f"CRITICAL: Baby at crib edge! ({dist:.0f}px)", 'critical', 'edge')
            tracker.trigger_cooldown('edge_crit')
            return True
        if dist < EDGE_WARN_DIST and tracker.is_cooled_down('edge_warn'):
            self.log_alert(f"Near crib edge ({dist:.0f}px)", 'warning', 'edge')
            tracker.trigger_cooldown('edge_warn')
            return True
        return False

    def _detect_limb_extension(self, kps, tracker):
        limb_triplets = [
            (5,  7,  9,  'left elbow'),
            (6,  8, 10, 'right elbow'),
            (11, 13, 15, 'left knee'),
            (12, 14, 16, 'right knee'),
        ]
        extended = []
        for a_i, b_i, c_i, name in limb_triplets:
            a = kp_valid(kps, a_i)
            b = kp_valid(kps, b_i)
            c = kp_valid(kps, c_i)
            if a and b and c:
                ang = angle_between(a, b, c)
                if ang > LIMB_EXTEND_ANGLE:
                    extended.append((name, ang))
        if len(extended) >= 2:
            tracker.limb_extend_ctr += 1
        else:
            tracker.limb_extend_ctr = 0
        if tracker.limb_extend_ctr > LIMB_EXTEND_FRAMES and tracker.is_cooled_down('limb'):
            names = ', '.join(n for n, _ in extended)
            self.log_alert(f"Extended limbs: {names}", 'warning', 'limb')
            tracker.trigger_cooldown('limb')
            tracker.limb_extend_ctr = 0
            return True
        return False

    def _estimate_breathing(self, kps, tracker):
        l = kp_valid(kps, 5)
        r = kp_valid(kps, 6)
        if not (l and r):
            return 'unclear'
        torso_y = (l[1] + r[1]) / 2
        tracker.torso_y_history.append(torso_y)
        if len(tracker.torso_y_history) < BREATHING_WINDOW // 2:
            return 'unclear'
        arr = np.array(tracker.torso_y_history)
        std = np.std(arr)
        if std < BREATHING_FLAT_TH:
            return 'no movement'
        fft   = np.abs(np.fft.rfft(arr - arr.mean()))
        freqs = np.fft.rfftfreq(len(arr), d=1.0/self.fps)
        valid = (freqs > 0.1) & (freqs < 1.5)
        if not valid.any():
            return 'unclear'
        peak_freq = freqs[valid][np.argmax(fft[valid])]
        bpm       = peak_freq * 60
        if 20 <= bpm <= 60:
            return f"{bpm:.0f} br/min ✓"
        elif bpm < 20:
            return f"{bpm:.0f} br/min (slow?)"
        else:
            return f"{bpm:.0f} br/min (fast?)"

    def _draw_skeleton(self, frame, kps):
        for p1i, p2i in SKELETON_PAIRS:
            pt1 = kp_valid(kps, p1i)
            pt2 = kp_valid(kps, p2i)
            if pt1 and pt2:
                cv2.line(frame, (int(pt1[0]), int(pt1[1])),
                         (int(pt2[0]), int(pt2[1])), (0, 230, 100), 2)
        for kp in kps:
            x, y, conf = kp
            if conf > CONF_THRESH:
                cv2.circle(frame, (int(x), int(y)), 4, (0, 80, 255), -1)

    def _draw_bounding_box(self, frame, kps, alert_level):
        pts = [(int(kp[0]), int(kp[1])) for kp in kps if kp[2] > CONF_THRESH]
        if not pts:
            return
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x1, y1 = max(0, min(xs) - 10), max(0, min(ys) - 10)
        x2, y2 = min(self.vid_w, max(xs) + 10), min(self.vid_h, max(ys) + 10)
        colour = SEVERITY_COLOUR.get(alert_level, (0, 230, 100))
        cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)

    def _check_pending_source(self):
        new_source = None
        with state.lock:
            if state.pending_video_source is not None:
                new_source = state.pending_video_source
                state.pending_video_source = None
        if new_source is not None:
            self.cap.release()
            self.cap = cv2.VideoCapture(new_source)
            self.video_source = new_source
            self.setup_mode = False
            self.auto_detect_crib()

    def _process_frame(self):
        self._check_pending_source()

        if self.setup_mode and self.setup_frame is not None:
            frame = self.setup_frame.copy()
            if isinstance(self.crib_roi, list):
                for pt in self.crib_roi:
                    cv2.circle(frame, (pt[0], pt[1]), 5, (0, 0, 255), -1)
                if len(self.crib_roi) > 1:
                    cv2.polylines(frame, [np.array(self.crib_roi, np.int32)],
                                  False, (255, 100, 0), 2)
            cv2.putText(frame, f"Click corners: {len(self.crib_roi)}/4",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                        (0, 200, 255), 2)
            return frame, 'unclear'

        ret, frame = self.cap.read()
        if not ret:
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            return None, 'unclear'

        if self.crib_roi is not None and len(self.crib_roi) >= 3:
            cv2.polylines(frame, [self.crib_roi], True, (255, 80, 0), 2)

        results = self.pose_model(frame, verbose=False)
        breathing_status = 'unclear'
        alert_level      = 'info'

        for det_idx, result in enumerate(results):
            if result.keypoints is None or len(result.keypoints.data) == 0:
                continue
            for person_idx, kp_tensor in enumerate(result.keypoints.data):
                kps = kp_tensor.cpu().numpy()
                uid = f"{det_idx}_{person_idx}"
                if uid not in self.trackers:
                    self.trackers[uid] = BabyTracker()
                tracker = self.trackers[uid]

                face_down = self._detect_face_down(kps, tracker)
                flip      = self._detect_flip(kps, tracker)
                still     = self._detect_stillness(kps, tracker)
                head_tilt = self._detect_head_tilt(kps, tracker)
                edge      = self._detect_edge_proximity(kps, tracker)
                limb      = self._detect_limb_extension(kps, tracker)
                breathing_status = self._estimate_breathing(kps, tracker)

                if face_down or flip:
                    alert_level = 'critical'
                elif still or head_tilt or edge or limb:
                    alert_level = max(alert_level, 'warning',
                                      key=lambda x: ['info','warning','critical'].index(x))

                tracker.tick_cooldowns()
                self._draw_skeleton(frame, kps)
                self._draw_bounding_box(frame, kps, alert_level)
                c = centroid(kps)
                if c:
                    cv2.putText(frame, alert_level.upper(),
                                (int(c[0]) - 30, int(c[1]) - 20),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                                SEVERITY_COLOUR.get(alert_level, (0,230,100)), 2)

        if self.use_gui and hasattr(self, 'breathing_label'):
            self.breathing_label.config(text=breathing_status)

        with state.lock:
            state.output_frame = frame.copy()
            state.breathing_status = breathing_status

        return frame, breathing_status

    def update(self):
        frame, _ = self._process_frame()
        if frame is None:
            if self.use_gui:
                self.window.after(self.delay, self.update)
            return

        if self.use_gui:
            self._show_frame(frame)
            self.window.after(self.delay, self.update)

    def _run_headless_loop(self):
        while getattr(self, 'no_gui_loop_running', True):
            frame, _ = self._process_frame()
            # keep latest data in state; no UI in this mode
            time.sleep(self.delay / 1000.0)

    def _show_frame(self, frame):
        if not self.use_gui:
            return
        rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img   = Image.fromarray(rgb)
        self.photo = ImageTk.PhotoImage(image=img)
        self.canvas.create_image(0, 0, image=self.photo, anchor=tk.NW)

    def __del__(self):
        if hasattr(self, 'cap') and self.cap.isOpened():
            self.cap.release()


# ──────────────────────────────────────────────
#  Entry point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='AI Baby Monitor server')
    parser.add_argument('--video-source', default=VIDEO_SOURCE, help='Path to input video file')
    parser.add_argument('--host', default='0.0.0.0', help='Flask host')
    parser.add_argument('--port', type=int, default=8080, help='Flask port')
    parser.add_argument('--no-gui', action='store_true', help='Run without Tkinter UI')
    args = parser.parse_args()

    flask_thread = threading.Thread(
        target=lambda: app.run(host=args.host, port=args.port, threaded=True, use_reloader=False)
    )
    flask_thread.daemon = True
    flask_thread.start()

    if args.no_gui:
        print(f"Starting headless baby monitor (video: {args.video_source})")
        monitor = BabyMonitorApp(video_source=args.video_source, use_gui=False)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            monitor.no_gui_loop_running = False
            print('Shutting down headless monitor')
    else:
        print(f"Starting GUI baby monitor (video: {args.video_source})")
        root = tk.Tk()
        monitor = BabyMonitorApp(root, "AI Baby Monitor", video_source=args.video_source, use_gui=True)

