ALTER TABLE "User" ADD COLUMN "bannerEditionId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_bannerEditionId_fkey"
  FOREIGN KEY ("bannerEditionId") REFERENCES "GameEdition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
