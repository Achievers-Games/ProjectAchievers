-- AlterTable
ALTER TABLE "LinkedAccount" ADD COLUMN     "backgroundMotionUrl" TEXT,
ADD COLUMN     "backgroundUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "backgroundSteam" BOOLEAN NOT NULL DEFAULT false;
