-- Les jeux hors Steam restés sans étiquettes retentent leur version Steam :
-- « II » et « 2 » désignent maintenant le même épisode.
UPDATE "Game" SET "tagsCheckedAt" = NULL WHERE platform <> 'STEAM' AND tags = '{}';
