-- Steam : le dernier passage du suivi en direct, affiché dans /compte.
ALTER TABLE "LinkedAccount" ADD COLUMN "liveCheckedAt" TIMESTAMP(3);
