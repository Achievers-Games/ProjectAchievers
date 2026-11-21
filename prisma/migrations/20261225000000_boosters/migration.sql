-- Boosters de cartes : éditions visuelles (Relief, Vivante, Mythique), éditions possédées,
-- ouvertures et compteurs du joueur (booster du jour, booster doré, garantie de Mythique).

-- CreateEnum
CREATE TYPE "EditionKind" AS ENUM ('RELIEF', 'VIVANTE', 'MYTHIQUE');

-- CreateEnum
CREATE TYPE "BoosterKind" AS ENUM ('NORMAL', 'GOLDEN', 'STARRED', 'CELESTIAL');

-- CreateEnum
CREATE TYPE "BoosterSource" AS ENUM ('DAILY', 'SHARDS', 'MISSION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShardReason" ADD VALUE 'BOOSTER';
ALTER TYPE "ShardReason" ADD VALUE 'DUPLICATE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "boostersOpened" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dailyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dailyBoosters" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pityMythique" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GameEdition" (
    "id" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "kind" "EditionKind" NOT NULL,
    "assetPath" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEdition" (
    "userId" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crafted" BOOLEAN NOT NULL DEFAULT false,
    "equipped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserEdition_pkey" PRIMARY KEY ("userId","editionId")
);

-- CreateTable
CREATE TABLE "BoosterOpening" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "BoosterKind" NOT NULL,
    "source" "BoosterSource" NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoosterOpening_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameEdition_familyKey_kind_key" ON "GameEdition"("familyKey", "kind");

-- CreateIndex
CREATE INDEX "BoosterOpening_userId_createdAt_idx" ON "BoosterOpening"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserEdition" ADD CONSTRAINT "UserEdition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEdition" ADD CONSTRAINT "UserEdition_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "GameEdition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoosterOpening" ADD CONSTRAINT "BoosterOpening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
