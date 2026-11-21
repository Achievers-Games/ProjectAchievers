ALTER TABLE "SteamIntegrityReview" ADD COLUMN "reviewOnly" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
