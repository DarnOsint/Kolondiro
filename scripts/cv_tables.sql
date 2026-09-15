-- ── RestaurantOS: CV / CCTV tables ──────────────────────────────────────
-- Run this in your Supabase SQL editor (once).
-- Safe to re-run — uses CREATE TABLE IF NOT EXISTS.

-- 1. People counts (occupancy)
CREATE TABLE IF NOT EXISTS cv_people_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupancy     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Alerts (intrusion, loitering, hazards, etc.)
CREATE TABLE IF NOT EXISTS cv_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id     text NOT NULL,
  alert_type    text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  description   text,
  resolved      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. Zone heatmaps (per-zone visit counts + dwell time)
CREATE TABLE IF NOT EXISTS cv_zone_heatmaps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_label          text NOT NULL,
  person_count        integer NOT NULL DEFAULT 0,
  avg_dwell_seconds   integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 4. Till anomaly events
CREATE TABLE IF NOT EXISTS cv_till_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 5. Bar shelf stock events
CREATE TABLE IF NOT EXISTS cv_shelf_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drink_name    text,
  alert_level   text NOT NULL CHECK (alert_level IN ('normal','low','critical','missing')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes for dashboard queries ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cv_people_counts_created   ON cv_people_counts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_alerts_created          ON cv_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_alerts_resolved         ON cv_alerts (resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_zone_heatmaps_created   ON cv_zone_heatmaps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_till_events_created     ON cv_till_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cv_shelf_events_created    ON cv_shelf_events (created_at DESC);

-- ── Enable realtime on all CV tables ──────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE cv_people_counts;
ALTER PUBLICATION supabase_realtime ADD TABLE cv_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE cv_zone_heatmaps;
ALTER PUBLICATION supabase_realtime ADD TABLE cv_till_events;
ALTER PUBLICATION supabase_realtime ADD TABLE cv_shelf_events;

-- ── RLS: allow service role full access, anon read-only ───────────────────
ALTER TABLE cv_people_counts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_zone_heatmaps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_till_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_shelf_events   ENABLE ROW LEVEL SECURITY;

-- Service role bypass (simulator + Pi script write via service role key)
CREATE POLICY IF NOT EXISTS "service role full access" ON cv_people_counts  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "service role full access" ON cv_alerts         FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "service role full access" ON cv_zone_heatmaps  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "service role full access" ON cv_till_events    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "service role full access" ON cv_shelf_events   FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read (for dashboard queries)
CREATE POLICY IF NOT EXISTS "authenticated read" ON cv_people_counts  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "authenticated read" ON cv_alerts         FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "authenticated read" ON cv_zone_heatmaps  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "authenticated read" ON cv_till_events    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "authenticated read" ON cv_shelf_events   FOR SELECT USING (auth.role() = 'authenticated');
