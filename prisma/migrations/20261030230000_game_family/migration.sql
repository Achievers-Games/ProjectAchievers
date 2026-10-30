-- AlterTable
ALTER TABLE "Game" ADD COLUMN "familyKey" TEXT,
ADD COLUMN "familyLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Game_familyKey_idx" ON "Game"("familyKey");
