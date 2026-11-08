-- Webhooks des sites partenaires : les nouveaux succès des joueurs reliés, envoyés et signés.
ALTER TABLE "PartnerApp" ADD COLUMN "slug" TEXT;
ALTER TABLE "PartnerApp" ADD COLUMN "webhookUrl" TEXT;
ALTER TABLE "PartnerApp" ADD COLUMN "webhookSecret" TEXT;
ALTER TABLE "PartnerApp" ADD COLUMN "webhookCursor" TIMESTAMP(3);
ALTER TABLE "PartnerApp" ADD COLUMN "webhookFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PartnerApp" ADD COLUMN "webhookLastAttemptAt" TIMESTAMP(3);
ALTER TABLE "PartnerApp" ADD COLUMN "webhookLastError" TEXT;

CREATE UNIQUE INDEX "PartnerApp_slug_key" ON "PartnerApp"("slug");
