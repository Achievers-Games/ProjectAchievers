ALTER TABLE "Game" ADD COLUMN "crossProgress" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SteamIntegrityReview" ADD COLUMN "proofAt" TIMESTAMP(3);

-- Jeux connus pour reprendre la progression d'une autre plateforme : Overwatch 2, Rainbow Six
-- Siege, Warframe, Diablo IV, Destiny 2, Rocket League, Fall Guys, Call of Duty.
UPDATE "Game" SET "crossProgress" = true
WHERE platform = 'STEAM'
  AND "platformGameId" IN ('2357570', '359550', '230410', '2344520', '1085660', '252950', '1097150', '1938090');

CREATE TABLE "SteamReviewProof" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reviewId" TEXT NOT NULL REFERENCES "SteamIntegrityReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "image" BYTEA,
  "imageType" TEXT,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SteamReviewProof_reviewId_createdAt_idx" ON "SteamReviewProof"("reviewId", "createdAt");
