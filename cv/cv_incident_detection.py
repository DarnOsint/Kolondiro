import cv2
import time
import threading
import numpy as np
from datetime import datetime, timezone
from supabase import create_client
from ultralytics import YOLO
from config import SUPABASE_URL, SUPABASE_KEY, CAMERAS, CONFIDENCE_THRESHOLD

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
model = YOLO('yolov8n-pose.pt')  # Pose model for incident detection

# Thresholds
CROWD_THRESHOLD = 5        # More than 5 people in frame = crowd alert
PROXIMITY_THRESHOLD = 0.15 # Bounding boxes overlap by >15% = too close (potential fight)
INCIDENT_COOLDOWN = 60     # Seconds between repeated alerts for same camera

last_alert_time = {}

def boxes_overlap_ratio(box1, box2, frame_w, frame_h):
    """Calculate overlap ratio between two bounding boxes."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    if x2 < x1 or y2 < y1:
        return 0.0
    intersection = (x2 - x1) * (y2 - y1)
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - intersection
    return intersection / union if union > 0 else 0.0

def trigger_alert(cam_id, zone, alert_type, details):
    """Push alert to Supabase with cooldown."""
    now = time.time()
    key = f'{cam_id}_{alert_type}'
    if now - last_alert_time.get(key, 0) < INCIDENT_COOLDOWN:
        return
    last_alert_time[key] = now
    print(f'[ALERT] {alert_type} on {cam_id} ({zone}): {details}')
    supabase_client.table('cv_alerts').insert({
        'camera_id': cam_id,
        'zone': zone,
        'alert_type': alert_type,
        'details': details,
        'resolved': False,
        'created_at': datetime.now(timezone.utc).isoformat(),
    }).execute()

def process_incidents(camera):
    cam_id = camera['id']
    zone = camera['zone']
    rtsp = camera['rtsp']
    print(f'[Incident] Starting {cam_id}')

    while True:
        try:
            cap = cv2.VideoCapture(rtsp)
            if not cap.isOpened():
                time.sleep(10)
                continue

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                results = model(frame, conf=CONFIDENCE_THRESHOLD, classes=[0], verbose=False)
                boxes = results[0].boxes.xyxy.tolist() if results[0].boxes else []
                count = len(boxes)

                # Crowd detection
                if count >= CROWD_THRESHOLD:
                    trigger_alert(cam_id, zone, 'crowd', {
                        'count': count,
                        'threshold': CROWD_THRESHOLD,
                        'message': f'{count} people detected in {zone}',
                    })

                # Proximity/fight detection — check if any two people are very close
                for i in range(len(boxes)):
                    for j in range(i + 1, len(boxes)):
                        overlap = boxes_overlap_ratio(boxes[i], boxes[j],
                                                       frame.shape[1], frame.shape[0])
                        if overlap > PROXIMITY_THRESHOLD:
                            trigger_alert(cam_id, zone, 'altercation', {
                                'overlap_ratio': round(overlap, 2),
                                'message': f'Possible altercation detected in {zone}',
                            })
                            break

                time.sleep(2)  # Check every 2 seconds for incidents

            cap.release()
        except Exception as e:
            print(f'[Incident] Error on {cam_id}: {e}')
            time.sleep(10)

if __name__ == '__main__':
    threads = []
    for cam in CAMERAS:
        t = threading.Thread(target=process_incidents, args=(cam,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
