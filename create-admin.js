'use strict';

/**
 * scripts/create-admin.js
 *
 * Run once on Render Shell (or locally) to create your first admin account:
 *
 *   ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD=YourStr0ngPass ADMIN_NAME="Your Name" node scripts/create-admin.js
 *
 * Or set those three env vars in Render Dashboard and run it via Shell.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma  = require('../src/config/prisma');

async function main() {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name     = process.env.ADMIN_NAME || 'Admin';

  if (!email || !password) {
    console.error('Usage: ADMIN_EMAIL=x ADMIN_PASSWORD=y node scripts/create-admin.js');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Upgrade existing user to admin
    const updated = await prisma.user.update({
      where: { email },
      data:  { role: 'admin', isEmailVerified: true },
    });
    console.log('✅ Existing user promoted to admin:', updated.email);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName:        name,
      role:            'admin',
      isEmailVerified: true,
      subscriptionStatus: 'premium',
    },
  });

  // Create analytics row for admin too
  await prisma.analytics.create({ data: { userId: admin.id } }).catch(() => {});

  console.log('✅ Admin account created:', admin.email);
  console.log('   ID:', admin.id);
  console.log('   Login at your admin panel with these credentials.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
