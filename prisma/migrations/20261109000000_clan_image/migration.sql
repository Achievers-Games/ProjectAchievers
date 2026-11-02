-- L'emblème d'un clan et le cadre qu'il a gagné.
ALTER TABLE "Clan" ADD COLUMN "image" BYTEA,
ADD COLUMN "imageType" TEXT,
ADD COLUMN "imageAt" TIMESTAMP(3),
ADD COLUMN "imagePending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "frame" TEXT;
