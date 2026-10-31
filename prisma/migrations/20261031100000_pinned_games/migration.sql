-- DropTable
DROP TABLE "PinnedAchievement";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "showcaseCustom" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PinnedGame" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PinnedGame_pkey" PRIMARY KEY ("userId","gameId")
);

-- AddForeignKey
ALTER TABLE "PinnedGame" ADD CONSTRAINT "PinnedGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedGame" ADD CONSTRAINT "PinnedGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
