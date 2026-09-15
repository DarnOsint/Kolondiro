-- Add daily_rate column to payroll table for daily-rate-based payroll calculation
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS daily_rate numeric(12,2) NOT NULL DEFAULT 0;
