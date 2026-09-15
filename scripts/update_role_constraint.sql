-- Update profiles role check constraint to include all roles
-- Run this in Supabase SQL Editor

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (
  role IN (
    'owner',
    'executive',
    'manager',
    'accountant',
    'auditor',
    'waitron',
    'kitchen',
    'bar',
    'griller',
    'games_master',
    'shisha_attendant',
    'supervisor',
    'apartment_manager',
    'floor_staff',
    'social_media_manager',
    'dj',
    'hypeman'
  )
);
