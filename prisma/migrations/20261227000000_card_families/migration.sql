-- Catalogue de cartes : un jeu (famille) s'active d'un bloc avec ses trois éditions, une même
-- rareté peut avoir plusieurs variantes, et les propriétaires d'une édition se retrouvent par index.

-- CreateTable
CREATE TABLE "CardFamily" (
    "familyKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardFamily_pkey" PRIMARY KEY ("familyKey")
);

-- Les éditions déjà créées gardent leur état : une famille reste active si toutes ses éditions l'étaient.
INSERT INTO "CardFamily" ("familyKey", "enabled")
SELECT "familyKey", bool_and("enabled") FROM "GameEdition" GROUP BY "familyKey";

-- DropIndex
DROP INDEX "GameEdition_familyKey_kind_key";

-- AlterTable
ALTER TABLE "GameEdition" DROP COLUMN "enabled",
ADD COLUMN     "variant" TEXT NOT NULL DEFAULT 'base';

-- CreateIndex
CREATE UNIQUE INDEX "GameEdition_familyKey_kind_variant_key" ON "GameEdition"("familyKey", "kind", "variant");

-- CreateIndex
CREATE INDEX "UserEdition_editionId_idx" ON "UserEdition"("editionId");

-- AddForeignKey
ALTER TABLE "GameEdition" ADD CONSTRAINT "GameEdition_familyKey_fkey" FOREIGN KEY ("familyKey") REFERENCES "CardFamily"("familyKey") ON DELETE CASCADE ON UPDATE CASCADE;
