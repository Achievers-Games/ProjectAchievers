-- Doublon de "Achievement_gameId_platformAchievementId_key", qui commence par la même colonne :
-- il ralentissait chaque écriture de succès sans servir aucune lecture.
DROP INDEX IF EXISTS "Achievement_gameId_idx";
