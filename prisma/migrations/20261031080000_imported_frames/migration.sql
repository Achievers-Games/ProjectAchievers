-- AlterTable
ALTER TABLE "User" ADD COLUMN "frameMotionUrl" TEXT;

-- AlterTable
ALTER TABLE "LinkedAccount" ADD COLUMN "frameUrl" TEXT,
ADD COLUMN "frameMotionUrl" TEXT;
