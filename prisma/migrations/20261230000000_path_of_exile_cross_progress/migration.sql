-- Path of Exile et Path of Exile 2 : le serveur du jeu accorde les succès Steam d'après la
-- progression du compte, jouable aussi avec le client autonome. Un lot à la même seconde y est
-- normal, et une remise à zéro les rendrait tous d'un coup à la connexion suivante.
UPDATE "Game" SET "crossProgress" = true
WHERE platform = 'STEAM' AND "platformGameId" IN ('238960', '2694490');
