import cv2
import time
import threading
from datetime import datetime, timezone
from supabase import create_client
from ultralytics import YOLO
from config import SUPABASE_URL, SUPABASE_KEY, CAMERAS, CONFIDENCE_THRESHOLD

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
model = YOLO('yolov8n.pt')

# Staff zones — areas where staff should/shouldn't be
STAFF_ZONES = {
    'bar':      {'expected': ['bar'], 'unexpected': ['vip', 'nook']},
    'kitchen':  {'expected': ['indoor'], 'unexpected': ['outdoor', 'vip']},
    'entrance': {'expected': ['entrance'], 'unexpected': []},
}

# Track person count per zone over time for movement patterns
zone_history = {}
ALERT_COOLDOWN = 120  # 2 minutes between zone alerts
last_zone_alert = {}

def process_staff_tracking(camera):
    cam_id = camera['id']
    zone = camera['zone']
    rtsp = camera['rtsp']
    print(f'[StaffTracking] Starting {cam_id} ({zone})')

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
                count = len(results[0].boxes) if results[0].boxes else 0

                # Track zone history
                if zone not in zone_history:
                    zone_history[zone] = []
                zone_history[zone].append({'time': time.time(), 'count': count})
                # Keep last 60 readings
                zone_history[zone] = zone_history[zone][-60:]

                # Push to heatmap
                supabase_client.table('cv_zone_heatmaps').insert({
                    'camera_id': cam_id,
                    'zone': zone,
                    'count': count,
                    'captured_at': datetime.now(timezone.utc).isoformat(),
                }).execute()

                # Detect unattended zones (0 staff for 15+ minutes during service hours)
                from datetime import datetime as dt
                current_hour = dt.now().hour
                is_service_hours = 10 <= current_hour <= 26  # 10am - 2am

                if is_service_hours and len(zone_history[zone]) >= 10:
                    recent = zone_history[zone][-10:]
                    if all(r['count'] == 0 for r in recent):
                        alert_key = f'{cam_id}_unattended'
                        now = time.time()
                        if now - last_zone_alert.get(alert_key, 0) > ALERT_COOLDOWN:
                            last_zone_alert[alert_key] = now
                            print(f'[StaffTracking] Zone {zone} appears unattended!')
                            supabase_client.table('cv_alerts').insert({
                                'camera_id': cam_id,
                                'zone': zone,
                                'alert_type': 'unattended_zone',
                                'details': {
                                    'message': f'{zone} zone has been unattended for over 10 minutes',
                                    'duration_minutes': 10,
                                },
                                'resolved': False,
                                'created_at': datetime.now(timezone.utc).isoformat(),
                            }).execute()

                time.sleep(5)

            cap.release()
        except Exception as e:
            print(f'[StaffTracking] Error on {cam_id}: {e}')
            time.sleep(10)

if __name__ == '__main__':
    threads = []
    for cam in CAMERAS:
        t = threading.Thread(target=process_staff_tracking, args=(cam,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
