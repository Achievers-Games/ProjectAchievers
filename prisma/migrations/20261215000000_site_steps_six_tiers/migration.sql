-- Les succès du site à paliers passent à six niveaux, de Bronze à Légendaire. Deux paliers en
-- trop disparaissent : 500 cartes (personne ne l'avait) et 2 500 succès débloqués.
DELETE FROM "SiteUnlock" WHERE code IN ('cards_500', 'unlocks_2500');
