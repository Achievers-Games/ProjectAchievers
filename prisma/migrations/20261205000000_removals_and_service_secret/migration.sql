-- Retrait des succès disparus chez la plateforme : la première lecture qui le constate est notée,
-- la seconde l'applique.
ALTER TABLE "UserGame" ADD COLUMN "removalSeenAt" TIMESTAMP(3);

-- Le NPSSO du compte de service PSN, chiffré, quand il est saisi depuis la modération.
ALTER TABLE "ServiceToken" ADD COLUMN "valueEnc" TEXT;
