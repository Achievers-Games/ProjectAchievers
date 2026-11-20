-- Éclats, la monnaie des boosters de cartes. Les joueurs existants commencent à la mise en ligne :
-- leur historique compte dans le capital de départ, plafonné, pas succès par succès.

-- CreateEnum
CREATE TYPE "ShardReason" AS ENUM ('ACHIEVEMENT', 'COMPLETION', 'STARTER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "shards" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shardsFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ShardEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "ShardReason" NOT NULL,
    "refId" TEXT NOT NULL,
    "gameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShardEntry_userId_gameId_idx" ON "ShardEntry"("userId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "ShardEntry_userId_reason_refId_key" ON "ShardEntry"("userId", "reason", "refId");

-- AddForeignKey
ALTER TABLE "ShardEntry" ADD CONSTRAINT "ShardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
