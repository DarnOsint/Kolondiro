#!/usr/bin/env python3
"""
cv_simulator.py — RestaurantOS CCTV data simulator
Pumps realistic computer-vision data into Supabase so the Executive and
Management dashboards light up before the Raspberry Pi arrives.

Usage:
    pip install supabase python-dotenv
    python scripts/cv_simulator.py

It reads VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local
(same file your dev server uses — no extra config needed).

Press Ctrl+C to stop.
"""

import os, sys, time, random, uuid
from datetime import datetime, timezone
from dotenv import load_dotenv

# ── Load env ──────────────────────────────────────────────────────────────
load_dotenv(dotenv_path='.env.local')

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local")
    sys.exit(1)

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase package not found. Run:  pip install supabase python-dotenv")
    sys.exit(1)

db = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Venue config ──────────────────────────────────────────────────────────

ZONES = ['Outdoor', 'Indoor', 'VIP Lounge', 'The Nook', 'Bar Area', 'Entrance']

CAMERAS = [
    'CAM-01 Entrance',
    'CAM-02 Outdoor',
    'CAM-03 Indoor-A',
    'CAM-04 Indoor-B',
    'CAM-05 VIP Lounge',
    'CAM-06 Bar',
    'CAM-07 Till',
    'CAM-08 Kitchen Door',
    'CAM-09 Car Park',
]

ALERT_TYPES = {
    'intrusion':        ('high',     'Person detected in restricted area after hours'),
    'loitering':        ('medium',   'Person stationary for over 10 minutes'),
    'crowd_density':    ('medium',   'Zone occupancy above safe threshold'),
    'till_open':        ('high',     'Till drawer opened without a sale'),
    'unattended_bag':   ('high',     'Unattended item detected for over 5 minutes'),
    'slip_hazard':      ('critical', 'Possible liquid spill detected on floor'),
    'staff_idle':       ('low',      'No staff detected at bar for over 3 minutes'),
    'unknown_person':   ('medium',   'Unrecognised person in staff-only area'),
}

TILL_ALERT_TYPES = [
    'till_open_no_sale',
    'multiple_void_sequence',
    'drawer_forced',
    'no_receipt_printed',
    'cash_counted_twice',
]

BAR_DRINKS = [
    'Heineken_600ml', 'Star_Lager', 'Guinness_Stout',
    'Smirnoff_Vodka', 'Hennessy_VS', 'Baileys',
    'Campari', 'Sprite_50cl', 'Coca_Cola_50cl',
]

SHELF_LEVELS = ['low', 'critical', 'missing']

# ── Helpers ───────────────────────────────────────────────────────────────

def now():
    return datetime.now(timezone.utc).isoformat()

def uid():
    return str(uuid.uuid4())

def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}")

# ── Simulation functions ──────────────────────────────────────────────────

def sim_occupancy():
    """Insert one people-count row — simulates a camera frame analysis."""
    hour = datetime.now().hour
    # Realistic occupancy curve: quiet morning, builds to evening peak
    if hour < 11:
        base = random.randint(0, 5)
    elif hour < 17:
        base = random.randint(5, 25)
    elif hour < 21:
        base = random.randint(20, 60)
    else:
        base = random.randint(30, 80)

    occupancy = base + random.randint(-3, 3)
    occupancy = max(0, occupancy)

    db.table('cv_people_counts').insert({
        'id': uid(),
        'occupancy': occupancy,
        'created_at': now(),
    }).execute()

    log(f"Occupancy → {occupancy} people")


def sim_zone_heatmap():
    """Insert zone activity snapshots for all venue zones."""
    hour = datetime.now().hour
    peak = hour >= 17

    rows = []
    for zone in ZONES:
        if zone == 'The Nook':
            count = random.randint(0, 8)
        elif zone == 'VIP Lounge' and peak:
            count = random.randint(4, 20)
        elif zone == 'Outdoor' and peak:
            count = random.randint(10, 35)
        else:
            count = random.randint(0, 15)

        dwell = random.randint(60, 1800)  # seconds

        rows.append({
            'id': uid(),
            'zone_label': zone,
            'person_count': count,
            'avg_dwell_seconds': dwell,
            'created_at': now(),
        })

    db.table('cv_zone_heatmaps').insert(rows).execute()
    log(f"Zone heatmap → {len(rows)} zones updated")


def sim_alert(force=False):
    """Occasionally insert a CV alert. force=True always inserts one."""
    if not force and random.random() > 0.15:  # 15% chance each cycle
        return

    alert_type, (severity, description) = random.choice(list(ALERT_TYPES.items()))
    camera = random.choice(CAMERAS)

    db.table('cv_alerts').insert({
        'id': uid(),
        'camera_id': camera,
        'alert_type': alert_type,
        'severity': severity,
        'description': description,
        'resolved': False,
        'created_at': now(),
    }).execute()

    log(f"ALERT [{severity.upper()}] {camera} — {alert_type}")


def sim_till_event(force=False):
    """Occasionally simulate a till anomaly."""
    if not force and random.random() > 0.08:  # 8% chance
        return

    alert_type = random.choice(TILL_ALERT_TYPES)

    db.table('cv_till_events').insert({
        'id': uid(),
        'alert_type': alert_type,
        'created_at': now(),
    }).execute()

    log(f"TILL EVENT — {alert_type}")


def sim_shelf_event(force=False):
    """Occasionally simulate a bar shelf stock alert."""
    if not force and random.random() > 0.10:  # 10% chance
        return

    drink = random.choice(BAR_DRINKS)
    level = random.choice(SHELF_LEVELS)

    db.table('cv_shelf_events').insert({
        'id': uid(),
        'drink_name': drink,
        'alert_level': level,
        'created_at': now(),
    }).execute()

    log(f"SHELF [{level.upper()}] {drink}")


def run_full_seed():
    """Seed all tables with a burst of data so dashboard shows immediately."""
    log("Seeding initial data burst...")

    # 5 occupancy readings over the last few minutes
    for _ in range(5):
        sim_occupancy()

    # Zone heatmaps
    sim_zone_heatmap()

    # Force 2 alerts, 1 till event, 2 shelf events so dashboard isn't empty
    sim_alert(force=True)
    sim_alert(force=True)
    sim_till_event(force=True)
    sim_shelf_event(force=True)
    sim_shelf_event(force=True)

    log("Initial seed complete — dashboard should be live now.\n")


def run_loop(interval_seconds=30):
    """Main loop — fires every N seconds, simulating continuous camera analysis."""
    log(f"Starting continuous simulation (interval: {interval_seconds}s)")
    log("Press Ctrl+C to stop.\n")

    cycle = 0
    while True:
        cycle += 1
        log(f"── Cycle {cycle} ──────────────────────────────")

        sim_occupancy()

        # Zone heatmaps every 5 cycles (~2.5 mins)
        if cycle % 5 == 0:
            sim_zone_heatmap()

        sim_alert()
        sim_till_event()
        sim_shelf_event()

        time.sleep(interval_seconds)


# ── Entry point ───────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='RestaurantOS CV Simulator')
    parser.add_argument('--seed-only', action='store_true',
                        help='Insert one burst of data and exit (no loop)')
    parser.add_argument('--interval', type=int, default=30,
                        help='Seconds between simulation cycles (default: 30)')
    parser.add_argument('--fast', action='store_true',
                        help='Run at 5s intervals for quick testing')
    args = parser.parse_args()

    run_full_seed()

    if args.seed_only:
        log("--seed-only: done.")
    else:
        interval = 5 if args.fast else args.interval
        run_loop(interval_seconds=interval)
