#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ReviveSpring Backend — Quick Start Script
# Usage: chmod +x setup.sh && ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo ""
echo "✝  ReviveSpring Backend Setup"
echo "─────────────────────────────────────────"

# 1. Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌  Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi
NODE_VER=$(node -v)
echo "✓ Node.js $NODE_VER"

# 2. Check .env
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "⚠  Created .env from .env.example"
  echo "   👉 Edit .env and fill in DATABASE_URL, JWT_SECRET, SMTP_* before continuing."
  echo ""
  read -p "Press ENTER when .env is configured..."
fi
echo "✓ .env found"

# 3. Install dependencies
echo ""
echo "📦 Installing npm packages..."
npm install

# 4. Generate Prisma client
echo ""
echo "🔧 Generating Prisma client..."
npx prisma generate

# 5. Run migrations
echo ""
echo "🗄  Running database migrations..."
npx prisma migrate dev --name init || {
  echo ""
  echo "⚠  Prisma migrate failed. Trying manual SQL..."
  echo "   Run prisma/manual_migration.sql on your PostgreSQL database manually."
}

# 6. Seed
echo ""
read -p "🌱 Seed demo data? (y/N): " SEED
if [[ "$SEED" =~ ^[Yy]$ ]]; then
  node src/config/seed.js
fi

# 7. Done
echo ""
echo "✅  Setup complete!"
echo ""
echo "Start the server:"
echo "  npm run dev     (development with hot reload)"
echo "  npm start       (production)"
echo ""
echo "API running at: http://localhost:3000"
echo "Health check:   http://localhost:3000/health"
echo ""
echo "Demo credentials (if seeded):"
echo "  Email:    demo@reviveme.app"
echo "  Password: password123"
echo ""
