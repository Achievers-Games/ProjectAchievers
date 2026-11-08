-- Les sites partenaires et la clé qui leur ouvre l'API publique.
CREATE TABLE "PartnerApp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerApp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerApp_name_key" ON "PartnerApp"("name");
CREATE UNIQUE INDEX "PartnerApp_keyHash_key" ON "PartnerApp"("keyHash");
