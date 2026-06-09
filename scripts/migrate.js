#!/usr/bin/env node
/**
 * Migration runner - ensures database is up to date before app starts.
 * Runs automatically when the app starts.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  console.log('[MIGRATE] Starting database migrations...');
  const migrationsPath = path.resolve(__dirname, '../prisma/migrations');
  const useMigrateDeploy = fs.existsSync(migrationsPath);

  try {
    if (useMigrateDeploy) {
      console.log('[MIGRATE] Found Prisma migrations folder. Running: npx prisma migrate deploy');
      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        env: { ...process.env }
      });
    } else {
      console.log('[MIGRATE] No Prisma migrations folder found. Running: npx prisma db push --accept-data-loss');
      execSync('npx prisma db push --accept-data-loss', {
        stdio: 'inherit',
        env: { ...process.env }
      });
    }
    console.log('✅ [MIGRATE] Schema sync completed successfully');
    const runtimeFixesPath = path.resolve(__dirname, '../prisma/support_runtime_fixes.sql');
    if (fs.existsSync(runtimeFixesPath)) {
      console.log('[MIGRATE] Applying support runtime fixes');
      execSync(`npx prisma db execute --schema prisma/schema.prisma --file "${runtimeFixesPath}"`, {
        stdio: 'inherit',
        env: { ...process.env }
      });
    }
    return true;
  } catch (error) {
    console.error('[MIGRATE] Error applying schema:', error.message);
    console.warn('[MIGRATE] WARNING: Database schema may not have been created. Check DATABASE_URL and Prisma schema.');
    return false;
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations().catch(err => {
    console.error('[MIGRATE] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
