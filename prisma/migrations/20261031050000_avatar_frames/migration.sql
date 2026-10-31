-- AlterTable
ALTER TABLE "User" ADD COLUMN "frame" TEXT;

-- CreateTable
CREATE TABLE "UserFrame" (
    "userId" TEXT NOT NULL,
    "frame" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFrame_pkey" PRIMARY KEY ("userId","frame")
);

-- AddForeignKey
ALTER TABLE "UserFrame" ADD CONSTRAINT "UserFrame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
