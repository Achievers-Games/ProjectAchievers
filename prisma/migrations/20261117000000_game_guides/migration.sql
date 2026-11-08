-- Un guide peut porter sur tout un jeu : il se suit du début à la fin pour atteindre 100 %.
ALTER TABLE "Guide" ALTER COLUMN "achievementId" DROP NOT NULL;
ALTER TABLE "Guide" ADD COLUMN "gameId" TEXT;
ALTER TABLE "Guide" ADD COLUMN "title" TEXT;

ALTER TABLE "Guide" ADD CONSTRAINT "Guide_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un succès ou un jeu, jamais les deux ni aucun.
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_target_check" CHECK (("achievementId" IS NULL) <> ("gameId" IS NULL));

CREATE INDEX "Guide_gameId_score_idx" ON "Guide"("gameId", "score");
