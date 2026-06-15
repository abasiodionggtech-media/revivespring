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
