-- Le compte d'un joueur sur un site partenaire, relié à son profil Achievers.
CREATE TABLE "PartnerLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerLink_partner_partnerUserId_key" ON "PartnerLink"("partner", "partnerUserId");
CREATE UNIQUE INDEX "PartnerLink_userId_partner_key" ON "PartnerLink"("userId", "partner");
CREATE INDEX "PartnerLink_userId_idx" ON "PartnerLink"("userId");

ALTER TABLE "PartnerLink" ADD CONSTRAINT "PartnerLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
