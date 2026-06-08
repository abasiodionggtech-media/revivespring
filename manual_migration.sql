-- ReviveMe Database Migration
-- Run this manually if you cannot use `npx prisma migrate dev`
-- Compatible with PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    full_name           VARCHAR(255),
    subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
    salvation_date      VARCHAR(20),
    testimony           TEXT,
    language            VARCHAR(10) NOT NULL DEFAULT 'en',
    is_email_verified   BOOLEAN NOT NULL DEFAULT false,
    otp_code            VARCHAR(10),
    otp_expires_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Prayers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prayers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mood            VARCHAR(100) NOT NULL,
    encouragement   TEXT,
    bible_verse     TEXT,
    bible_reference VARCHAR(100),
    prayer_text     TEXT NOT NULL,
    action_step     TEXT,
    language        VARCHAR(10) NOT NULL DEFAULT 'en',
    is_saved        BOOLEAN NOT NULL DEFAULT false,
    created_date    VARCHAR(20),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Journal Entries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        VARCHAR(500) NOT NULL,
    content      TEXT NOT NULL,
    mood         VARCHAR(100),
    status       VARCHAR(50) NOT NULL DEFAULT 'active',
    language     VARCHAR(10) NOT NULL DEFAULT 'en',
    tags         TEXT[] NOT NULL DEFAULT '{}',
    created_date VARCHAR(20),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Daily Goals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_goals (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    completed  BOOLEAN NOT NULL DEFAULT false,
    date       VARCHAR(20) NOT NULL,
    language   VARCHAR(10) NOT NULL DEFAULT 'en',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Analytics ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_prayers    INTEGER NOT NULL DEFAULT 0,
    answered_prayers INTEGER NOT NULL DEFAULT 0,
    current_streak   INTEGER NOT NULL DEFAULT 0,
    longest_streak   INTEGER NOT NULL DEFAULT 0,
    last_active_date VARCHAR(20),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prayers_user_id    ON prayers(user_id);
CREATE INDEX IF NOT EXISTS idx_prayers_mood       ON prayers(mood);
CREATE INDEX IF NOT EXISTS idx_journal_user_id    ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_status     ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_goals_user_date    ON daily_goals(user_id, date);
CREATE INDEX IF NOT EXISTS idx_analytics_user_id  ON analytics(user_id);

-- ─── Auto-update updated_at trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users', 'journal_entries', 'daily_goals', 'analytics']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'update_' || t || '_updated_at'
        ) THEN
            EXECUTE format(
                'CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
                t, t
            );
        END IF;
    END LOOP;
END;
$$;

-- Done!
-- To verify: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
CREATE TABLE IF NOT EXISTS "daily_goal_templates" (
  "id" TEXT NOT NULL,
  "title_en" TEXT NOT NULL,
  "title_fr" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'reflection',
  "content_en" TEXT,
  "content_fr" TEXT,
  "duration_seconds" INTEGER NOT NULL DEFAULT 10,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_goal_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "daily_goals" ADD COLUMN IF NOT EXISTS "template_id" TEXT;
ALTER TABLE "daily_goals" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'reflection';
ALTER TABLE "daily_goals" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "daily_goals" ADD COLUMN IF NOT EXISTS "duration_seconds" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "daily_goals" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'general',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "metadata" JSONB,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT 'Customer care message',
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "messages" JSONB NOT NULL DEFAULT '[]',
  "last_reply_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "support_tickets_user_id_status_updated_at_idx" ON "support_tickets"("user_id", "status", "updated_at");

CREATE TABLE IF NOT EXISTS "account_sessions" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "client" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_sessions_user_id_client_key" ON "account_sessions"("user_id", "client");
CREATE INDEX IF NOT EXISTS "account_sessions_user_id_last_seen_at_idx" ON "account_sessions"("user_id", "last_seen_at");
CREATE UNIQUE INDEX IF NOT EXISTS "daily_goals_user_id_date_template_id_key" ON "daily_goals"("user_id", "date", "template_id");
DO $$ BEGIN
  ALTER TABLE "daily_goals" ADD CONSTRAINT "daily_goals_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "daily_goal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
