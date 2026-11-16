-- Succès déjà fêtés : la mémoire suit le compte, plus seulement le navigateur.
ALTER TABLE "UserAchievement" ADD COLUMN "celebratedAt" TIMESTAMP(3);

-- Ceux de la dernière semaine ont déjà été montrés : un nouvel appareil ne doit pas les rejouer.
UPDATE "UserAchievement" SET "celebratedAt" = NOW() WHERE "unlockedAt" >= NOW() - INTERVAL '7 days';
