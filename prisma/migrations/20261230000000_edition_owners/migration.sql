-- Le nombre de propriétaires de chaque édition, tenu à jour à l'ouverture des boosters : la
-- collection affiche la rareté réelle d'une carte sans compter les possessions à chaque visite.

-- AlterTable
ALTER TABLE "GameEdition" ADD COLUMN "ownerCount" INTEGER NOT NULL DEFAULT 0;

-- Les éditions déjà possédées partent de leur compte actuel.
UPDATE "GameEdition" e
SET "ownerCount" = owned.count
FROM (SELECT "editionId", count(*)::int AS count FROM "UserEdition" GROUP BY "editionId") owned
WHERE owned."editionId" = e.id;
