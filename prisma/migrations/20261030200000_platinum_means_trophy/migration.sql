-- "platinum" ne désigne plus que le trophée PlayStation : le 100 % se lit dans "completion".
UPDATE "UserGame" ug
SET "platinum" = false
WHERE ug."platinum"
  AND NOT EXISTS (
    SELECT 1
    FROM "UserAchievement" ua
    JOIN "Achievement" a ON a."id" = ua."achievementId"
    WHERE ua."userId" = ug."userId"
      AND a."gameId" = ug."gameId"
      AND a."trophyType" = 'PLATINUM'
  );
