-- « Premier du site » et « seul du site » : retirés, ils devenaient plus durs à mesure que le site grandit.
DELETE FROM "SiteUnlock" WHERE code IN ('first_ever', 'only_one');
