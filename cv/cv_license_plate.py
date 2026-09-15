import cv2
import time
import threading
import re
from datetime import datetime, timezone
from supabase import create_client
from ultralytics import YOLO
from config import SUPABASE_URL, SUPABASE_KEY, CAMERAS

supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Only run on entrance camera
ENTRANCE_CAMERAS = ['cam_08']

# Try to import easyocr for plate reading
try:
    import easyocr
    ocr_reader = easyocr.Reader(['en'], gpu=False)
    OCR_AVAILABLE = True
    print('[LPR] EasyOCR loaded')
except ImportError:
    OCR_AVAILABLE = False
    print('[LPR] EasyOCR not available — install with: pip install easyocr')

def clean_plate(text):
    """Clean OCR output to extract plate-like text."""
    text = re.sub(r'[^A-Z0-9]', '', text.upper())
    if len(text) >= 5:
        return text
    return None

def process_lpr(camera):
    cam_id = camera['id']
    if cam_id not in ENTRANCE_CAMERAS:
        return

    rtsp = camera['rtsp']
    print(f'[LPR] Starting on {cam_id}')
    last_plates = set()

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

                if OCR_AVAILABLE:
                    # Crop bottom half of frame where plates usually appear
                    h, w = frame.shape[:2]
                    crop = frame[h//2:, :]
                    results = ocr_reader.readtext(crop)

                    for (_, text, confidence) in results:
                        if confidence > 0.5:
                            plate = clean_plate(text)
                            if plate and plate not in last_plates:
                                last_plates.add(plate)
                                print(f'[LPR] Plate detected: {plate}')
                                supabase_client.table('cv_events').insert({
                                    'camera_id': cam_id,
                                    'event_type': 'license_plate',
                                    'zone': 'entrance',
                                    'data': {
                                        'plate': plate,
                                        'confidence': round(confidence, 2),
                                    },
                                    'created_at': datetime.now(timezone.utc).isoformat(),
                                }).execute()

                    # Keep only last 20 plates to avoid memory growth
                    if len(last_plates) > 20:
                        last_plates = set(list(last_plates)[-20:])

                time.sleep(3)

            cap.release()
        except Exception as e:
            print(f'[LPR] Error on {cam_id}: {e}')
            time.sleep(10)

if __name__ == '__main__':
    threads = []
    for cam in CAMERAS:
        t = threading.Thread(target=process_lpr, args=(cam,), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
