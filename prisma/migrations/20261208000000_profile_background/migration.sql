-- AlterTable
ALTER TABLE "User" ADD COLUMN     "backgroundGameId" TEXT,
ADD COLUMN     "backgroundOff" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_backgroundGameId_fkey" FOREIGN KEY ("backgroundGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
