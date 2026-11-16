-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bannerGameId" TEXT,
ADD COLUMN     "bannerOff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bannerSteam" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_bannerGameId_fkey" FOREIGN KEY ("bannerGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
