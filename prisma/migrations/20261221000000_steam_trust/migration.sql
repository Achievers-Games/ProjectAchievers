ALTER TABLE "UserGame" ADD COLUMN "offlinePlaytimeMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SteamIntegrityReview" ADD COLUMN "trust" JSONB;
ALTER TABLE "SteamIntegrityReview" ADD COLUMN "emptySeenAt" TIMESTAMP(3);
ALTER TABLE "SteamIntegrityReview" ADD COLUMN "resetAt" TIMESTAMP(3);
