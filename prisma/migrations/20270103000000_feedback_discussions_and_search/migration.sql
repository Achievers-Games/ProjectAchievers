BEGIN;

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

ALTER TABLE "Game" ADD COLUMN "achievementGroupsSyncedAt" TIMESTAMP(3);
ALTER TABLE "Achievement" ADD COLUMN "groupId" TEXT, ADD COLUMN "groupName" TEXT;

ALTER TABLE "Comment" ADD COLUMN "profileId" TEXT;
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Comment_profileId_createdAt_idx" ON "Comment"("profileId", "createdAt");

ALTER TABLE "Comment" DROP CONSTRAINT "Comment_one_target_check";
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_one_target";
ALTER TABLE "Comment" ADD COLUMN "unlockOwnerId" TEXT, ADD COLUMN "unlockAchievementId" TEXT;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_unlockOwnerId_unlockAchievementId_fkey"
  FOREIGN KEY ("unlockOwnerId", "unlockAchievementId") REFERENCES "UserAchievement"("userId", "achievementId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Comment_unlockOwnerId_unlockAchievementId_createdAt_idx"
  ON "Comment"("unlockOwnerId", "unlockAchievementId", "createdAt");
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_one_target_check" CHECK (
  ("unlockOwnerId" IS NULL) = ("unlockAchievementId" IS NULL)
  AND num_nonnulls("achievementId", "guideId", "profileId", "unlockOwnerId") = 1
);

CREATE TYPE "ActivityEmoji" AS ENUM ('CLAP', 'FIRE', 'HEART', 'WOW', 'LAUGH', 'TROPHY', 'STRONG', 'SAD');
CREATE TABLE "LiveReaction" (
  "ownerId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" "ActivityEmoji" NOT NULL,
  CONSTRAINT "LiveReaction_pkey" PRIMARY KEY ("ownerId", "gameId", "userId"),
  CONSTRAINT "LiveReaction_ownerId_gameId_fkey" FOREIGN KEY ("ownerId","gameId") REFERENCES "UserGame"("userId","gameId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LiveReaction_userId_idx" ON "LiveReaction"("userId");
CREATE TABLE "UnlockReaction" (
  "ownerId" TEXT NOT NULL,
  "achievementId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" "ActivityEmoji" NOT NULL,
  CONSTRAINT "UnlockReaction_pkey" PRIMARY KEY ("ownerId", "achievementId", "userId"),
  CONSTRAINT "UnlockReaction_ownerId_achievementId_fkey" FOREIGN KEY ("ownerId","achievementId") REFERENCES "UserAchievement"("userId","achievementId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UnlockReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UnlockReaction_userId_idx" ON "UnlockReaction"("userId");

COMMIT;
