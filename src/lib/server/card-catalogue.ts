import { EDITIONS } from '#lib/boosters';
import {
  CARD_CATALOGUE,
  publishedCardPath,
  publishedVariantPath,
  type CatalogueGame,
} from '#lib/card-catalogue';
import { logger } from '#lib/logger';
import { db } from './db';

const log = logger('Catalogue de cartes');

/**
 * Recopie le catalogue en base. Rejouable : chaque jeu crée ou met à jour sa famille et ses
 * éditions, un jeu retiré du catalogue est désactivé (ses cartes restent possédées). Un jeu que
 * personne n'a encore importé attend : sa famille n'existe pas tant que le jeu n'est pas en base.
 * Renvoie le nombre de jeux recopiés.
 */
export async function syncCardCatalogue(catalogue: readonly CatalogueGame[] = CARD_CATALOGUE) {
  const games = await db.game.findMany({
    where: {
      platform: 'STEAM',
      platformGameId: { in: catalogue.map((entry) => entry.steamAppId) },
      familyKey: { not: null },
    },
    select: { platformGameId: true, familyKey: true },
  });
  const families = new Map(games.map((game) => [game.platformGameId, game.familyKey!]));
  const listed: string[] = [];
  for (const entry of catalogue) {
    const familyKey = families.get(entry.steamAppId);
    if (!familyKey) continue;
    listed.push(familyKey);
    await db.$transaction([
      db.cardFamily.upsert({
        where: { familyKey },
        create: { familyKey, enabled: entry.enabled },
        update: { enabled: entry.enabled },
      }),
      ...EDITIONS.map((kind) =>
        db.gameEdition.upsert({
          where: { familyKey_kind_variant: { familyKey, kind, variant: 'base' } },
          create: { familyKey, kind, assetPath: publishedCardPath(entry, kind) },
          update: { assetPath: publishedCardPath(entry, kind) },
        }),
      ),
      ...(entry.variants ?? []).map((variant) =>
        db.gameEdition.upsert({
          where: { familyKey_kind_variant: { familyKey, kind: variant.kind, variant: variant.id } },
          create: {
            familyKey,
            kind: variant.kind,
            variant: variant.id,
            assetPath: publishedVariantPath(entry, variant),
          },
          update: { assetPath: publishedVariantPath(entry, variant), retired: false },
        }),
      ),
      // Une variante qui n'est plus au catalogue sort des boosters ; les éditions de base, jamais.
      db.gameEdition.updateMany({
        where: {
          familyKey,
          variant: { notIn: ['base', ...(entry.variants ?? []).map((variant) => variant.id)] },
          retired: false,
        },
        data: { retired: true },
      }),
    ]);
  }
  const retired = await db.cardFamily.updateMany({
    where: { familyKey: { notIn: listed }, enabled: true },
    data: { enabled: false },
  });
  if (retired.count) log.info(`${retired.count} jeu(x) retiré(s) des boosters`);
  return listed.length;
}
