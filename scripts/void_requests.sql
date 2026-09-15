-- Create void_requests table for barman/kitchen void approval flow
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS void_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  reason text,
  station text NOT NULL DEFAULT 'bar',
  requested_by uuid REFERENCES profiles(id),
  requested_by_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_name text
);

-- Enable RLS
ALTER TABLE void_requests ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "void_requests_read" ON void_requests FOR SELECT TO authenticated USING (true);

-- Allow all authenticated users to insert
CREATE POLICY "void_requests_insert" ON void_requests FOR INSERT TO authenticated WITH CHECK (true);

-- Allow all authenticated users to update
CREATE POLICY "void_requests_update" ON void_requests FOR UPDATE TO authenticated USING (true);

-- Allow anon access for POS
CREATE POLICY "void_requests_anon_read" ON void_requests FOR SELECT TO anon USING (true);
CREATE POLICY "void_requests_anon_insert" ON void_requests FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "void_requests_anon_update" ON void_requests FOR UPDATE TO anon USING (true);
