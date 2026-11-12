-- Rareté commune : moyenne des minima par liste, puis moyenne à poids égal par plateforme.
-- Sans taux, recours au nombre moyen de succès par plateforme.
WITH versions AS (
      SELECT COALESCE(g."familyKey", g.id) AS family, g.platform,
        (min(a."globalRarity") FILTER (WHERE a."globalRarity" > 0 AND a."globalRarity" <= 100))::numeric AS rarity,
        count(a.id) AS size
      FROM "Game" g LEFT JOIN "Achievement" a ON a."gameId" = g.id

      GROUP BY g.id
    ), platforms AS (
      SELECT family, platform, avg(rarity) AS rarity, avg(size) FILTER (WHERE size > 0) AS size
      FROM versions GROUP BY family, platform
    ), averages AS (
      SELECT family, avg(rarity) AS rarity, COALESCE(avg(size), 0) AS size
      FROM platforms GROUP BY family
    ), tiers AS (
      SELECT family, CASE WHEN rarity IS NOT NULL THEN CASE WHEN rarity >= 10::numeric THEN 1 WHEN rarity >= 4::numeric THEN 2 WHEN rarity >= 2::numeric THEN 3 WHEN rarity >= 1::numeric THEN 4 WHEN rarity >= 0.3::numeric THEN 5 ELSE 6 END
        ELSE CASE WHEN size < 20 THEN 1 WHEN size < 40 THEN 2 WHEN size < 70 THEN 3 WHEN size < 120 THEN 4 WHEN size < 300 THEN 5 ELSE 6 END END AS tier
      FROM averages
    )
    UPDATE "Game" g SET tier = tiers.tier
    FROM tiers
    WHERE COALESCE(g."familyKey", g.id) = tiers.family AND g.tier IS DISTINCT FROM tiers.tier;
