-- Variantes de cartes (autre illustration, événement) : une variante retirée du catalogue ne sort
-- plus des boosters, mais ses propriétaires la gardent.

-- AlterTable
ALTER TABLE "GameEdition" ADD COLUMN "retired" BOOLEAN NOT NULL DEFAULT false;
