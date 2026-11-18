-- L'ancienne URL du CDN renvoie une photo de lapin pour ce jeu.
UPDATE "Game"
SET "headerUrl" = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3556750/f60b47fa49e3582f21c39f6b123fb59e2b441292/header.jpg?t=1783120204'
WHERE "platform" = 'STEAM'
  AND "platformGameId" = '3556750'
  AND ("headerUrl" IS NULL OR "headerUrl" LIKE '%/steam/apps/3556750/header.jpg%');
