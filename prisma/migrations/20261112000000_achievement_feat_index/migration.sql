-- Le fil des exploits lit d'abord le catalogue des succès. Sans cet index partiel, il en
-- balayait les 100 000 lignes à chaque affichage de /communaute. Prisma ne sait pas décrire un
-- index partiel : d'où ce SQL écrit à la main, avec les colonnes que la jointure utilise.
CREATE INDEX "Achievement_feat_idx" ON "Achievement" (id) INCLUDE ("gameId")
  WHERE ("trophyType" = 'PLATINUM' OR "globalRarity" < 1);
