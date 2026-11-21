-- Préparation des cartes : l'artwork officiel choisi pour la Mythique de chaque jeu, avant le catalogue.

-- CreateTable
CREATE TABLE "CardPlan" (
    "familyKey" TEXT NOT NULL,
    "mythiqueArtUrl" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPlan_pkey" PRIMARY KEY ("familyKey")
);

