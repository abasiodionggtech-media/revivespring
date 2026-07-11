-- Safe production repair for support tickets created by raw SQL.
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "subject" TEXT NOT NULL DEFAULT 'Customer care message',
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "messages" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_reply_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "support_tickets"
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "support_tickets"
SET "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
    "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS "support_tickets_user_id_status_updated_at_idx"
ON "support_tickets"("user_id", "status", "updated_at");

CREATE TABLE IF NOT EXISTS "device_tokens" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL UNIQUE,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "device_tokens_user_id_last_seen_at_idx"
ON "device_tokens"("user_id", "last_seen_at");

-- Admin dashboard compatibility for older/newer users table shapes.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT NOT NULL DEFAULT 'free';

UPDATE "users"
SET "subscriptionStatus" = COALESCE("subscriptionStatus", 'free');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'subscription_status'
  ) THEN
    UPDATE "users"
    SET "subscriptionStatus" = COALESCE(NULLIF("subscriptionStatus", 'free'), "subscription_status", 'free');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Force-add columns that `prisma db push` has been observed NOT applying on
-- the live database (it reports "in sync" but the columns are missing,
-- which silently breaks seeding). These IF NOT EXISTS guards are safe to
-- run on every startup and fix the schema regardless of what db push does.
-- ─────────────────────────────────────────────────────────────────────────

-- Multi-translation columns for the daily verses / Verse of the Moment.
ALTER TABLE "daily_verses"
  ADD COLUMN IF NOT EXISTS "verse_fr"  TEXT,
  ADD COLUMN IF NOT EXISTS "verse_kjv" TEXT,
  ADD COLUMN IF NOT EXISTS "verse_nlt" TEXT,
  ADD COLUMN IF NOT EXISTS "verse_esv" TEXT,
  ADD COLUMN IF NOT EXISTS "active_on" TEXT,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Streak grace-period tracking on analytics.
ALTER TABLE "analytics"
  ADD COLUMN IF NOT EXISTS "grace_period_used"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "grace_used_on_date" TEXT,
  ADD COLUMN IF NOT EXISTS "visit_count"        INTEGER NOT NULL DEFAULT 0;

-- Font customization + password-linking + purchase-token columns on users.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "font_family"         TEXT NOT NULL DEFAULT 'Inter',
  ADD COLUMN IF NOT EXISTS "font_scale"          DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "last_purchase_token" TEXT;

-- Reading plans: JSON "days" column used by the seed.
ALTER TABLE "reading_plans"
  ADD COLUMN IF NOT EXISTS "days" JSONB;
UPDATE "reading_plans" SET "days" = '[]'::jsonb WHERE "days" IS NULL;

-- Memory card progress columns used by the 7-day recall feature.
ALTER TABLE "memory_card_progress"
  ADD COLUMN IF NOT EXISTS "quiz_attempts"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mastered"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quiz_passed_at" TIMESTAMP(3);

-- Challenge suggestions table (user-submitted prayer challenge ideas).
CREATE TABLE IF NOT EXISTS "challenge_suggestions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "support_ticket_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Weekly review table (guards against the "findUnique of undefined" error).
CREATE TABLE IF NOT EXISTS "weekly_reviews" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "week_start_date" TEXT NOT NULL,
  "ai_summary" TEXT,
  "user_reflection" TEXT,
  "stats" JSONB,
  "generated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "weekly_reviews_user_id_week_start_date_key"
ON "weekly_reviews"("user_id", "week_start_date");
