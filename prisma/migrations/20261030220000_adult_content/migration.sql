-- AlterTable
ALTER TABLE "User" ADD COLUMN "showAdult" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN "adultOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "contentCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Game_adultOnly_idx" ON "Game"("adultOnly");
