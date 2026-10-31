-- CreateTable
CREATE TABLE "GameTranslation" (
    "gameId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTranslation_pkey" PRIMARY KEY ("gameId","locale")
);

-- CreateTable
CREATE TABLE "AchievementTranslation" (
    "achievementId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AchievementTranslation_pkey" PRIMARY KEY ("achievementId","locale")
);

-- AddForeignKey
ALTER TABLE "GameTranslation" ADD CONSTRAINT "GameTranslation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementTranslation" ADD CONSTRAINT "AchievementTranslation_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
