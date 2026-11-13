-- La bibliothèque Steam liste désormais les jeux partagés en famille et les jeux gratuits :
-- plus de recherche chez les amis ni de balayage de la boutique, donc plus de dates à retenir.
ALTER TABLE "LinkedAccount" DROP COLUMN "sharedCheckedAt", DROP COLUMN "storeSweptAt";
