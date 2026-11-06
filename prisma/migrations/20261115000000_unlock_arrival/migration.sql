-- Arrivée d'un succès sur le site, distincte de sa date de déblocage sur la plateforme.
ALTER TABLE "UserAchievement" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Les succès déjà importés ne sont plus des nouvelles : ils arrivent à leur date de déblocage.
UPDATE "UserAchievement" SET "createdAt" = "unlockedAt";

CREATE INDEX "UserAchievement_userId_createdAt_idx" ON "UserAchievement"("userId", "createdAt");
