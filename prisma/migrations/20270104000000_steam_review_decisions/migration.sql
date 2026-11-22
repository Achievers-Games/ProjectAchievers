CREATE TYPE "SteamDecision" AS ENUM ('APPROVED', 'PARTIAL', 'BLOCKED', 'UNBLOCKED');

CREATE TABLE "SteamReviewDecision" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "moderatorId" TEXT,
  "decision" "SteamDecision" NOT NULL,
  "accepted" INTEGER NOT NULL DEFAULT 0,
  "refused" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SteamReviewDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SteamReviewDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "SteamIntegrityReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SteamReviewDecision_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SteamReviewDecision_reviewId_createdAt_idx" ON "SteamReviewDecision"("reviewId", "createdAt");
CREATE INDEX "SteamReviewDecision_moderatorId_idx" ON "SteamReviewDecision"("moderatorId");

-- Reprend la dernière décision de chaque dossier : les précédentes n'étaient pas gardées.
INSERT INTO "SteamReviewDecision" ("id", "reviewId", "moderatorId", "decision", "accepted", "refused", "createdAt")
SELECT gen_random_uuid()::text, r."id", u."id",
  CASE
    WHEN r."status" = 'APPROVED' THEN 'APPROVED'
    WHEN r."suspendedAt" IS NOT NULL THEN 'BLOCKED'
    ELSE 'PARTIAL'
  END::"SteamDecision",
  CASE WHEN r."suspendedAt" IS NULL THEN cardinality(r."approved") ELSE 0 END,
  cardinality(r."rejected"),
  r."reviewedAt"
FROM "SteamIntegrityReview" r
LEFT JOIN "User" u ON u."id" = r."reviewedBy"
WHERE r."reviewedBy" IS NOT NULL AND r."reviewedAt" IS NOT NULL AND r."status" <> 'PENDING';
