-- Les jeux récents n'ont pas d'icônes sur l'ancien serveur que l'API Steam indique encore.
UPDATE "Achievement"
SET "iconUrl" = replace("iconUrl", 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/', 'https://shared.fastly.steamstatic.com/community_assets/images/apps/'),
    "iconLockedUrl" = replace("iconLockedUrl", 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/', 'https://shared.fastly.steamstatic.com/community_assets/images/apps/')
WHERE "iconUrl" LIKE 'https://steamcdn-a.akamaihd.net/%' OR "iconLockedUrl" LIKE 'https://steamcdn-a.akamaihd.net/%';
