ALTER TABLE "PartnerApp"
  ADD COLUMN "webhookCursorUserId" TEXT,
  ADD COLUMN "webhookCursorAchievementId" TEXT;

CREATE INDEX "UserAchievement_createdAt_userId_achievementId_idx"
  ON "UserAchievement" ("createdAt", "userId", "achievementId");
