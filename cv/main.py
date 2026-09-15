import cv2
import time
import threading
import numpy as np
from datetime import datetime, timezone
from supabase import create_client
from ultralytics import YOLO
from config import (
    SUPABASE_URL, SUPABASE_KEY, CAMERAS,
    DETECTION_INTERVAL, CONFIDENCE_THRESHOLD, YOLO_MODEL
)

# ── Init ──────────────────────────────────────────────────────────────────────
supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
model = YOLO(YOLO_MODEL)
print('✅ YOLOv8 model loaded')

# Import all detection modules
from cv_incident_detection import process_incidents, trigger_alert
from cv_table_occupancy import process_table_occupancy
from cv_staff_tracking import process_staff_tracking
from cv_license_plate import process_lpr

# ── People counting (core) ────────────────────────────────────────────────────
def process_people_count(camera):
    cam_id = camera['id']
    cam_name = camera['name']
    zone = camera['zone']
    rtsp = camera['rtsp']
    print(f'📷 [PeopleCount] Starting: {cam_name} ({zone})')

    while True:
        try:
            cap = cv2.VideoCapture(rtsp)
            if not cap.isOpened():
                print(f'❌ Cannot connect to {cam_name} — retrying in 10s')
                time.sleep(10)
                continue

            while True:
                ret, frame = cap.read()
                if not ret:
                    print(f'⚠️ Lost feed from {cam_name} — reconnecting')
                    break

                results = model(frame, conf=CONFIDENCE_THRESHOLD, classes=[0], verbose=False)
                count = len(results[0].boxes) if results[0].boxes else 0
                print(f'[{cam_name}] 👥 {count} people')

                supabase_client.table('cv_people_counts').insert({
                    'camera_id': cam_id,
                    'camera_name': cam_name,
                    'zone': zone,
                    'count': count,
                    'captured_at': datetime.now(timezone.utc).isoformat(),
                }).execute()

                time.sleep(DETECTION_INTERVAL)

            cap.release()
        except Exception as e:
            print(f'❌ [PeopleCount] Error on {cam_name}: {e}')
            time.sleep(10)


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print('🚀 RestaurantOS CV Module starting...')
    print(f'   Cameras: {len(CAMERAS)}')
    print(f'   Detection interval: {DETECTION_INTERVAL}s')
    print(f'   Confidence threshold: {CONFIDENCE_THRESHOLD}')
    print()

    threads = []

    for camera in CAMERAS:
        # Core people counting
        t1 = threading.Thread(target=process_people_count, args=(camera,), daemon=True)
        # Incident detection
        t2 = threading.Thread(target=process_incidents, args=(camera,), daemon=True)
        # Table occupancy
        t3 = threading.Thread(target=process_table_occupancy, args=(camera,), daemon=True)
        # Staff tracking
        t4 = threading.Thread(target=process_staff_tracking, args=(camera,), daemon=True)
        # License plate (entrance only — handled inside the function)
        t5 = threading.Thread(target=process_lpr, args=(camera,), daemon=True)

        for t in [t1, t2, t3, t4, t5]:
            t.start()
            threads.append(t)

    print(f'✅ {len(threads)} threads started across {len(CAMERAS)} cameras')
    print('   Modules: people counting, incident detection, table occupancy,')
    print('            staff tracking, license plate recognition')
    print()

    for t in threads:
        t.join()
