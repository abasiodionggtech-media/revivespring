const crypto = require('crypto');

const prisma = require('../config/prisma');

let ensurePromise;

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapTicket(row) {
  if (!row) return null;
  const user = row.email
    ? {
        id: row.user_id,
        email: row.email,
        fullName: row.full_name,
        subscriptionStatus: row.subscription_status,
        language: row.language,
      }
    : undefined;

  return {
    id: row.id,
    userId: row.user_id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    messages: parseJsonArray(row.messages),
    lastReplyAt: row.last_reply_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(user ? { user } : {}),
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: row.metadata || {},
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

async function ensureSupportTables() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "notifications" (
          "id" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "type" TEXT NOT NULL DEFAULT 'general',
          "title" TEXT NOT NULL,
          "body" TEXT NOT NULL,
          "metadata" JSONB,
          "read_at" TIMESTAMP(3),
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_created_at_idx"
        ON "notifications"("user_id", "read_at", "created_at")
      `);
      await prisma.$executeRawUnsafe(`
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
        )
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "support_tickets"
        ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
        ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP
      `);
      await prisma.$executeRawUnsafe(`
        UPDATE "support_tickets"
        SET "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
            "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "support_tickets_user_id_status_updated_at_idx"
        ON "support_tickets"("user_id", "status", "updated_at")
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "account_sessions" (
          "id" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "client" TEXT NOT NULL,
          "ip_address" TEXT,
          "user_agent" TEXT,
          "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "account_sessions_user_id_client_key"
        ON "account_sessions"("user_id", "client")
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "account_sessions_user_id_last_seen_at_idx"
        ON "account_sessions"("user_id", "last_seen_at")
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "device_tokens" (
          "id" TEXT PRIMARY KEY,
          "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "token" TEXT NOT NULL UNIQUE,
          "platform" TEXT NOT NULL DEFAULT 'android',
          "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "device_tokens_user_id_last_seen_at_idx"
        ON "device_tokens"("user_id", "last_seen_at")
      `);
    })();
  }
  return ensurePromise;
}

async function listUserTickets(userId, limit = 50) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "support_tickets" WHERE "user_id" = $1 ORDER BY "updated_at" DESC LIMIT $2`,
    userId,
    limit
  );
  return rows.map(mapTicket);
}

async function findUserTicket(ticketId, userId) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "support_tickets" WHERE "id" = $1 AND "user_id" = $2 LIMIT 1`,
    ticketId,
    userId
  );
  return mapTicket(rows[0]);
}

async function createSupportTicket({ user, subject, message }) {
  await ensureSupportTables();
  const ticketId = makeId();
  const messages = [{
    id: makeId(),
    role: 'user',
    senderName: user.fullName || 'Customer',
    senderEmail: user.email,
    body: message,
    createdAt: new Date().toISOString(),
  }];
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "support_tickets" ("id", "user_id", "subject", "messages", "created_at", "updated_at")
     VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    ticketId,
    user.id,
    subject || 'Customer care message',
    JSON.stringify(messages)
  );
  return mapTicket(rows[0]);
}

async function addUserTicketMessage({ ticket, user, message }) {
  await ensureSupportTables();
  const messages = parseJsonArray(ticket.messages);
  messages.push({
    id: makeId(),
    role: 'user',
    senderName: user.fullName || 'Customer',
    senderEmail: user.email,
    body: message,
    createdAt: new Date().toISOString(),
  });
  const status = ticket.status === 'closed' ? 'open' : ticket.status;
  const rows = await prisma.$queryRawUnsafe(
    `UPDATE "support_tickets"
     SET "messages" = $2::jsonb, "status" = $3, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1
     RETURNING *`,
    ticket.id,
    JSON.stringify(messages),
    status
  );
  return mapTicket(rows[0]);
}

async function listAdminTickets({ status, limit = 50 }) {
  await ensureSupportTables();
  const safeLimit = Math.min(100, Number(limit || 50));
  const baseSelect = `
    SELECT st.*, u.email, u.full_name, u.subscription_status, u.language
    FROM "support_tickets" st
    INNER JOIN "users" u ON u.id = st.user_id
  `;
  const rows = status
    ? await prisma.$queryRawUnsafe(`${baseSelect} WHERE st.status = $1 ORDER BY st.updated_at DESC LIMIT $2`, status, safeLimit)
    : await prisma.$queryRawUnsafe(`${baseSelect} ORDER BY st.updated_at DESC LIMIT $1`, safeLimit);
  return rows.map(mapTicket);
}

async function findAdminTicket(ticketId) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT st.*, u.email, u.full_name, u.subscription_status, u.language
     FROM "support_tickets" st
     INNER JOIN "users" u ON u.id = st.user_id
     WHERE st.id = $1
     LIMIT 1`,
    ticketId
  );
  return mapTicket(rows[0]);
}

async function addAdminTicketReply({ ticket, admin, message, status = 'answered' }) {
  await ensureSupportTables();
  const messages = parseJsonArray(ticket.messages);
  messages.push({
    id: makeId(),
    role: 'admin',
    senderName: admin.fullName || 'ReviveSpring Care',
    senderEmail: admin.email,
    body: message,
    createdAt: new Date().toISOString(),
  });
  const rows = await prisma.$queryRawUnsafe(
    `UPDATE "support_tickets"
     SET "messages" = $2::jsonb,
         "status" = $3,
         "last_reply_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1
     RETURNING *`,
    ticket.id,
    JSON.stringify(messages),
    status
  );
  const updated = mapTicket(rows[0]);
  return { ...updated, user: ticket.user };
}

async function createNotification({ userId, type = 'general', title, body, metadata = {} }) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "notifications" ("id", "user_id", "type", "title", "body", "metadata")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    makeId(),
    userId,
    type,
    title,
    body,
    JSON.stringify(metadata || {})
  );
  return mapNotification(rows[0]);
}

async function listNotifications(userId, limit = 50) {
  await ensureSupportTables();
  const safeLimit = Math.min(100, Number(limit || 50));
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "notifications" WHERE "user_id" = $1 ORDER BY "created_at" DESC LIMIT $2`,
    userId,
    safeLimit
  );
  return rows.map(mapNotification);
}

async function countUnreadNotifications(userId) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "notifications" WHERE "user_id" = $1 AND "read_at" IS NULL`,
    userId
  );
  return Number(rows[0]?.count || 0);
}

async function markNotificationRead(notificationId, userId) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `UPDATE "notifications"
     SET "read_at" = COALESCE("read_at", CURRENT_TIMESTAMP)
     WHERE "id" = $1 AND "user_id" = $2
     RETURNING "id"`,
    notificationId,
    userId
  );
  return rows.length;
}

async function markAllNotificationsRead(userId) {
  await ensureSupportTables();
  await prisma.$executeRawUnsafe(
    `UPDATE "notifications"
     SET "read_at" = COALESCE("read_at", CURRENT_TIMESTAMP)
     WHERE "user_id" = $1 AND "read_at" IS NULL`,
    userId
  );
}

async function findOtherAccountSession(userId, client) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "account_sessions"
     WHERE "user_id" = $1 AND "client" <> $2
     ORDER BY "last_seen_at" DESC
     LIMIT 1`,
    userId,
    client
  );
  return rows[0] || null;
}

async function upsertAccountSession({ userId, client, ipAddress, userAgent }) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "account_sessions" ("id", "user_id", "client", "ip_address", "user_agent", "last_seen_at")
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT ("user_id", "client")
     DO UPDATE SET
       "ip_address" = EXCLUDED."ip_address",
       "user_agent" = EXCLUDED."user_agent",
       "last_seen_at" = CURRENT_TIMESTAMP
     RETURNING *`,
    makeId(),
    userId,
    client,
    ipAddress || null,
    userAgent || null
  );
  return rows[0] || null;
}

async function upsertDeviceToken({ userId, token, platform = 'android' }) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO "device_tokens" ("id", "user_id", "token", "platform", "last_seen_at")
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT ("token")
     DO UPDATE SET
       "user_id" = EXCLUDED."user_id",
       "platform" = EXCLUDED."platform",
       "last_seen_at" = CURRENT_TIMESTAMP
     RETURNING *`,
    makeId(),
    userId,
    token,
    platform
  );
  return rows[0] || null;
}

async function listUserDeviceTokens(userId) {
  await ensureSupportTables();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "token" FROM "device_tokens"
     WHERE "user_id" = $1
     ORDER BY "last_seen_at" DESC
     LIMIT 20`,
    userId
  );
  return rows.map((row) => row.token).filter(Boolean);
}

module.exports = {
  addAdminTicketReply,
  addUserTicketMessage,
  countUnreadNotifications,
  createNotification,
  createSupportTicket,
  ensureSupportTables,
  findAdminTicket,
  findUserTicket,
  listAdminTickets,
  listNotifications,
  listUserTickets,
  markAllNotificationsRead,
  markNotificationRead,
  findOtherAccountSession,
  upsertAccountSession,
  listUserDeviceTokens,
  upsertDeviceToken,
};
