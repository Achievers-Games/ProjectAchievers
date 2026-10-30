#!/bin/bash

# Project Achievers - Development Startup Script

set -e

echo "🚀 Starting Project Achievers Development Environment"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f backend/.env ]; then
    echo -e "${YELLOW}⚠️  backend/.env not found. Creating from .env.example...${NC}"
    cp backend/.env.example backend/.env
    echo -e "${RED}❗ Please edit backend/.env with your API keys before continuing!${NC}"
    echo "Required keys:"
    echo "  - STEAM_API_KEY (from https://steamcommunity.com/dev/apikey)"
    echo "  - STEAM_CLIENT_ID / STEAM_CLIENT_SECRET (if using Steam OAuth)"
    echo "  - DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET (from Discord Developer Portal)"
    echo "  - JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY (generate with: openssl rand -hex 32)"
    exit 1
fi

# Install backend dependencies
echo -e "${GREEN}📦 Installing backend dependencies...${NC}"
cd backend
npm install

# Generate Prisma client
echo -e "${GREEN}🔧 Generating Prisma client...${NC}"
npx prisma generate

# Run migrations
echo -e "${GREEN}🗄️  Running database migrations...${NC}"
npx prisma migrate dev --name init

# Seed database
echo -e "${GREEN}🌱 Seeding database...${NC}"
npx tsx prisma/seed.ts

cd ..

# Install frontend dependencies
echo -e "${GREEN}📦 Installing frontend dependencies...${NC}"
npm install

# Build frontend types (if needed)
# npm run db:generate

echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "To start development servers:"
echo "  Terminal 1: cd backend && npm run dev"
echo "  Terminal 2: npm run dev"
echo ""
echo "Or use Docker:"
echo "  docker-compose up"
echo ""
echo "Frontend: http://localhost:5173"
echo "Backend API: http://localhost:3001"
echo "API Health: http://localhost:3001/api/health"
echo "Prisma Studio: cd backend && npx prisma studio"