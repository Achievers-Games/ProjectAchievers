-- Les commentaires s'ouvrent aux guides complets des jeux : un commentaire vise un succès ou un guide.
ALTER TABLE "Comment" ALTER COLUMN "achievementId" DROP NOT NULL;
ALTER TABLE "Comment" ADD COLUMN "guideId" TEXT;

CREATE INDEX "Comment_guideId_createdAt_idx" ON "Comment"("guideId", "createdAt");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un commentaire vise exactement une chose.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_one_target" CHECK (("achievementId" IS NULL) <> ("guideId" IS NULL));
