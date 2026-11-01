-- Le prochain passage relit le catalogue StarCraft II et en retire les récompenses internes.
UPDATE "Game" SET "schemaSyncedAt" = NULL WHERE "platform" = 'BLIZZARD' AND "platformGameId" = 'sc2';
