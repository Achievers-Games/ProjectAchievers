-- Les événements de compte destinés aux partenaires : relié, délié, modifié.
CREATE TABLE "PartnerEvent" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "via" TEXT,
    "partnerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "PartnerEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerEvent_appId_deliveredAt_createdAt_idx" ON "PartnerEvent"("appId", "deliveredAt", "createdAt");

ALTER TABLE "PartnerEvent" ADD CONSTRAINT "PartnerEvent_appId_fkey" FOREIGN KEY ("appId") REFERENCES "PartnerApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerEvent" ADD CONSTRAINT "PartnerEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
