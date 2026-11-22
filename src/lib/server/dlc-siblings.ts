import { achievementPart } from '#lib/shards';
import { logger } from '#lib/logger';
import { db } from './db';
import { creditSplitGame } from './shards';

const log = logger('DLC');

/** Un groupe repris de la version PlayStation du même jeu. */
export const SIBLING_GROUP = 'psn:';

/** La moitié des trophées PlayStation au moins : en dessous, ce n'est pas le même jeu. */
const SAME_GAME = 0.5;
/** Un DLC se reprend quand presque tous ses succès existent ici aussi. */
const SAME_DLC = 0.6;
/** Familles lues à la fois : le serveur continue de répondre entre deux lots. */
const BATCH = 15;

export interface NamedAchievement {
  platformAchievementId: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  platinum: boolean;
}

const normalize = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

const plain = (text: string) => text.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();

/** « Trophées pour la Fondation », « DOOM Eternal : The Ancient Gods » : le nom du DLC suffit. */
export function dlcName(groupName: string, game = '') {
  let name = plain(groupName)
    .replace(/^(?:les\s+)?(?:troph[ée]es?|succès)\s+(?:pour|de|du|des)\s+/i, '')
    .replace(/^(?:troph[ée]es?|succès)\s+d['’]/i, '');
  const title = plain(game).toLowerCase();
  if (title && name.toLowerCase().startsWith(title)) {
    // Un vrai séparateur : « Borderlands 2 » ne se coupe pas après « Borderlands ».
    const rest = /^\s*[:–—-]\s*(.+)$/.exec(name.slice(title.length))?.[1];
    if (rest) name = rest;
  }
  return name ? name[0]!.toUpperCase() + name.slice(1) : groupName;
}

/**
 * Le groupe de chaque succès, d'après la version PlayStation du jeu : les succès y portent les
 * mêmes noms, et les DLC y sont toujours à part. `null` si ce n'est pas le même jeu.
 */
export function inferGroups(game: NamedAchievement[], psn: NamedAchievement[], title = '') {
  const trophies = psn.filter((trophy) => !trophy.platinum);
  const byName = new Map<string, NamedAchievement | null>();
  for (const trophy of trophies) {
    const name = normalize(trophy.name);
    if (!name) continue;
    const known = byName.get(name);
    // Deux trophées du même nom dans deux groupes : on ne sait pas lequel est celui d'ici.
    byName.set(
      name,
      known === undefined || (known && known.groupId === trophy.groupId) ? trophy : null,
    );
  }
  const here = new Set(game.map((achievement) => normalize(achievement.name)));
  const found = trophies.filter((trophy) => here.has(normalize(trophy.name)));
  if (!trophies.length || found.length / trophies.length < SAME_GAME) return null;

  const kept = new Set<string>();
  for (const [groupId, members] of Map.groupBy(trophies, (trophy) => trophy.groupId ?? '')) {
    if (!achievementPart(groupId)) continue;
    const present = members.filter((trophy) => here.has(normalize(trophy.name)));
    if (present.length / members.length >= SAME_DLC) kept.add(groupId);
  }
  const groups = new Map<string, { groupId: string; groupName: string }>();
  for (const achievement of game) {
    const trophy = byName.get(normalize(achievement.name));
    if (trophy?.groupId && kept.has(trophy.groupId)) {
      groups.set(achievement.platformAchievementId, {
        groupId: `${SIBLING_GROUP}${trophy.groupId}`,
        groupName: dlcName(trophy.groupName ?? '', title),
      });
    }
  }
  return { coverage: found.length / trophies.length, groups };
}

let lastRun: Date | null = null;

/** Pour les tests : la prochaine lecture reprend tout le catalogue. */
export const resetSiblingDlc = () => (lastRun = null);

/**
 * Sépare les DLC des jeux Steam et Xbox que leur éditeur ne découpe pas, d'après leur version
 * PlayStation. Un jeu qui publie ses propres DLC garde les siens. Le premier passage lit tout, les
 * suivants les seules familles relues entre-temps. Renvoie le nombre de jeux modifiés.
 */
export async function inferSiblingDlc(now = new Date()) {
  const since = lastRun ?? new Date(0);
  const families = await db.$queryRaw<{ familyKey: string }[]>`
    SELECT g."familyKey" FROM "Game" g
    WHERE g."familyKey" IS NOT NULL
    GROUP BY g."familyKey"
    HAVING bool_or(g.platform IN ('STEAM', 'XBOX'))
      AND bool_or(g.platform = 'PSN' AND g."achievementGroupsSyncedAt" IS NOT NULL)
      AND (max(g."schemaSyncedAt") >= ${since} OR max(g."achievementGroupsSyncedAt") >= ${since}
        OR max(g."updatedAt") >= ${since})
    ORDER BY 1`;
  let changed = 0;
  for (let offset = 0; offset < families.length; offset += BATCH) {
    const games = await db.game.findMany({
      where: {
        familyKey: { in: families.slice(offset, offset + BATCH).map((row) => row.familyKey) },
        platform: { in: ['STEAM', 'XBOX', 'PSN'] },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        platform: true,
        familyKey: true,
        achievements: {
          select: {
            platformAchievementId: true,
            name: true,
            groupId: true,
            groupName: true,
            trophyType: true,
          },
        },
      },
    });
    const listed = games.map(({ achievements, ...game }) => ({
      ...game,
      achievements: achievements.map(({ trophyType, ...row }) => ({
        ...row,
        platinum: trophyType === 'PLATINUM',
      })),
    }));
    for (const family of Map.groupBy(listed, (game) => game.familyKey).values()) {
      const siblings = family.filter(
        (game) =>
          game.platform === 'PSN' && game.achievements.some((row) => achievementPart(row.groupId)),
      );
      for (const game of family) {
        if (game.platform === 'PSN') continue;
        try {
          if (await applyGroups(game, siblings)) changed += 1;
        } catch (cause) {
          log.error(`« ${game.name} » :`, cause);
        }
      }
    }
  }
  lastRun = now;
  return changed;
}

interface ListedGame {
  id: string;
  name: string;
  achievements: NamedAchievement[];
}

async function applyGroups(game: ListedGame, siblings: ListedGame[]) {
  const isInferred = (groupId: string | null) => groupId?.startsWith(SIBLING_GROUP) ?? false;
  // L'éditeur découpe déjà ce jeu : son découpage fait foi.
  const published = game.achievements.some(
    (row) => achievementPart(row.groupId) && !isInferred(row.groupId),
  );
  const best = published
    ? null
    : siblings
        .map((sibling) => inferGroups(game.achievements, sibling.achievements, sibling.name))
        .filter((result) => result !== null)
        .sort((a, b) => b.coverage - a.coverage || b.groups.size - a.groups.size)[0];
  const separated = Boolean(best?.groups.size);

  const moves = game.achievements.flatMap((row) => {
    const target =
      best?.groups.get(row.platformAchievementId) ??
      // Le reste est le jeu de base ; un DLC repris puis disparu y revient.
      ((separated && !row.groupId) || isInferred(row.groupId)
        ? { groupId: 'default', groupName: '' }
        : null);
    return target && (target.groupId !== row.groupId || target.groupName !== row.groupName)
      ? [{ row, target }]
      : [];
  });
  if (!moves.length) return false;
  for (const [key, group] of Map.groupBy(
    moves,
    ({ target }) => `${target.groupId}|${target.groupName}`,
  )) {
    void key;
    await db.achievement.updateMany({
      where: {
        gameId: game.id,
        platformAchievementId: { in: group.map(({ row }) => row.platformAchievementId) },
      },
      data: group[0]!.target,
    });
  }
  if (
    moves.some(
      ({ row, target }) => achievementPart(row.groupId) !== achievementPart(target.groupId),
    )
  ) {
    await creditSplitGame(game.id);
  }
  return true;
}
