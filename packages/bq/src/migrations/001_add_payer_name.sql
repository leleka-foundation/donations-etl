-- Migration: Add payer_name column to existing tables
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS)
--
-- This migration adds the payer_name field to support the check_deposits source,
-- which tracks the financial institution (e.g., "Vanguard Charitable") that issued the check.

ALTER TABLE donations_raw.stg_events
ADD COLUMN IF NOT EXISTS payer_name STRING;

ALTER TABLE donations.events
ADD COLUMN IF NOT EXISTS payer_name STRING;
