-- Steam : la position du succès dans les statistiques du jeu, pour le reconnaître tout de suite.
ALTER TABLE "Achievement" ADD COLUMN "steamStatBit" INTEGER;
CREATE INDEX "Achievement_gameId_steamStatBit_idx" ON "Achievement"("gameId", "steamStatBit");
