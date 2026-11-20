CREATE TYPE "SteamReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "UserGame" ADD COLUMN "reportedUnlockedCount" INTEGER;
ALTER TABLE "Game" ADD COLUMN "allowSteamBatches" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Game" SET "allowSteamBatches" = true
WHERE platform = 'STEAM' AND name LIKE 'Zup!%';

CREATE TABLE "SteamIntegrityReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "steamId" TEXT NOT NULL,
  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "gameId" TEXT NOT NULL REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" "SteamReviewStatus" NOT NULL DEFAULT 'PENDING',
  "suspendedAt" TIMESTAMP(3),
  "flagged" TEXT[] NOT NULL,
  "approved" TEXT[] NOT NULL,
  "rejected" TEXT[] NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT
);

CREATE UNIQUE INDEX "SteamIntegrityReview_steamId_gameId_key" ON "SteamIntegrityReview"("steamId", "gameId");
CREATE INDEX "SteamIntegrityReview_status_openedAt_idx" ON "SteamIntegrityReview"("status", "openedAt");
CREATE INDEX "SteamIntegrityReview_userId_suspendedAt_idx" ON "SteamIntegrityReview"("userId", "suspendedAt");
