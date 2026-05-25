#!/usr/bin/env node
/**
 * Migration runner - ensures database is up to date before app starts.
 * Runs automatically when the app starts.
 */
const { execSync } = require('child_process');

async function runMigrations() {
  console.log('[MIGRATE] Starting database migrations...');
  
  try {
    // Run Prisma migrations deploy
    console.log('[MIGRATE] Running: npx prisma migrate deploy');
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env }
    });
    console.log('✅ [MIGRATE] Migrations completed successfully');
    return true;
  } catch (error) {
    console.error('[MIGRATE] Error running migrations:', error.message);
    // Don't fail the app start — migrations might have been already applied
    // or DB might be temporarily unavailable. The app will start but requests will fail
    // with clearer Prisma errors if tables are missing.
    console.warn('[MIGRATE] WARNING: Migrations may not have been applied. Check database connection.');
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
