-- Recherche par nom : `ILIKE '%mot%'` parcourait toute la table. L'index trigramme la sert.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Game_name_trgm_idx" ON "Game" USING GIN ("name" gin_trgm_ops);

-- Un compte supprimé doit encore pouvoir prévenir ses partenaires : l'événement survit au
-- joueur, dont il garde l'identifiant à part.
ALTER TABLE "PartnerEvent" DROP CONSTRAINT "PartnerEvent_userId_fkey";
ALTER TABLE "PartnerEvent" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "PartnerEvent" ADD COLUMN "subjectId" TEXT;
ALTER TABLE "PartnerEvent" ADD CONSTRAINT "PartnerEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Règles que seul le code garantissait. `NOT VALID` : elles valent pour toute nouvelle ligne,
-- sans relire les anciennes, donc la migration ne peut pas échouer sur des données existantes.
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_one_target_check"
  CHECK (("achievementId" IS NULL) <> ("gameId" IS NULL)) NOT VALID;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_one_target_check"
  CHECK (("achievementId" IS NULL) <> ("guideId" IS NULL)) NOT VALID;
ALTER TABLE "PartnerLink" ADD CONSTRAINT "PartnerLink_method_check"
  CHECK ("method" IN ('AUTO', 'MANUAL')) NOT VALID;
ALTER TABLE "PartnerEvent" ADD CONSTRAINT "PartnerEvent_type_check"
  CHECK ("type" IN ('user.linked', 'user.unlinked', 'user.updated', 'user.deleted')) NOT VALID;
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_kind_check"
  CHECK ("kind" IN ('CODE', 'ACCESS', 'REFRESH')) NOT VALID;
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_kind_check"
  CHECK ("kind" IN ('START', 'SIGNUP', 'LOGIN', 'ERROR')) NOT VALID;
