import cv2
import time
import threading
import numpy as np
from datetime import datetime, timezone
from supabase import create_client
from ultralytics import YOLO
from config import SUPABASE_URL, SUPABASE_KEY, CAMERAS, DETECTION_INTERVAL, CONFIDENCE_THRESHOLD

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
model = YOLO('yolov8n.pt')

# Table zones per camera — define bounding box regions (x1,y1,x2,y2) as % of frame
# These will need calibrating once cameras are live
# Format: { camera_id: [ { table_id, x1%, y1%, x2%, y2% } ] }
TABLE_ZONES = {
    'cam_01': [
        {'table_id': 'Table 1',  'x1': 0.0,  'y1': 0.0,  'x2': 0.5,  'y2': 0.5},
        {'table_id': 'Table 2',  'x1': 0.5,  'y1': 0.0,  'x2': 1.0,  'y2': 0.5},
        {'table_id': 'Table 3',  'x1': 0.0,  'y1': 0.5,  'x2': 0.5,  'y2': 1.0},
        {'table_id': 'Table 4',  'x1': 0.5,  'y1': 0.5,  'x2': 1.0,  'y2': 1.0},
    ],
}

def is_person_in_zone(box, zone, frame_w, frame_h):
    """Check if a detected person's bounding box overlaps with a table zone."""
    px1, py1, px2, py2 = box
    zx1 = zone['x1'] * frame_w
    zy1 = zone['y1'] * frame_h
    zx2 = zone['x2'] * frame_w
    zy2 = zone['y2'] * frame_h
    return not (px2 < zx1 or px1 > zx2 or py2 < zy1 or py1 > zy2)

def process_table_occupancy(camera):
    cam_id = camera['id']
    zones = TABLE_ZONES.get(cam_id, [])
    if not zones:
        return  # No zones defined for this camera

    rtsp = camera['rtsp']
    print(f'[TableOccupancy] Starting {cam_id}')

    while True:
        try:
            cap = cv2.VideoCapture(rtsp)
            if not cap.isOpened():
                print(f'[TableOccupancy] Cannot connect to {cam_id}, retrying in 10s')
                time.sleep(10)
                continue

            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                h, w = frame.shape[:2]
                results = model(frame, conf=CONFIDENCE_THRESHOLD, classes=[0], verbose=False)
                boxes = results[0].boxes.xyxy.tolist() if results[0].boxes else []

                for zone in zones:
                    occupied = any(is_person_in_zone(box, zone, w, h) for box in boxes)
                    supabase_client.table('cv_events').insert({
                        'camera_id': cam_id,
                        'event_type': 'table_occupancy',
                        'zone': camera['zone'],
                        'data': {
                            'table_id': zone['table_id'],
                            'occupied': occupied,
                        },
                        'created_at': datetime.now(timezone.utc).isoformat(),
                    }).execute()

                time.sleep(DETECTION_INTERVAL)

            cap.release()
        except Exception as e:
            print(f'[TableOccupancy] Error on {cam_id}: {e}')
            time.sleep(10)

if __name__ == '__main__':
    threads = []
    for cam in CAMERAS:
        t = threading.Thread(target=process_table_occupancy, args=(cam,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
