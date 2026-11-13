-- Steam : le joueur garde son temps de jeu privé, la plateforme n'en donne donc aucun.
ALTER TABLE "LinkedAccount" ADD COLUMN "playtimeHidden" BOOLEAN NOT NULL DEFAULT false;
