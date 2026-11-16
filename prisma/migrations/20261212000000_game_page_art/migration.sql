-- Le fond de la page boutique passe avant la capture : chaque jeu est relu une fois.
UPDATE "Game" SET "artCheckedAt" = NULL;
