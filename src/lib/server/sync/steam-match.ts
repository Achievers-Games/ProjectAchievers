import { db } from '../db';
import type { TopAchievement } from './steam';

/**
 * GetTopAchievementsForGames voit un succès quelques secondes après son déblocage, mais ne donne
 * pas son identifiant technique : seulement sa position dans les statistiques du jeu
 * (`statid`, `bit`), son nom, sa description et son icône. Ce module relie chaque entrée au
 * catalogue du site.
 *
 * La position est la seule donnée sûre : unique dans le jeu, indépendante de la langue et des
 * images. Le catalogue de Steam ne la donne pas, et son ordre ne la suit pas (mesuré : juste sur
 * 3 jeux sur 12). Elle s'apprend donc : un succès reconnu sans doute possible par son icône, son
 * nom et sa description garde sa position, et sera reconnu par elle ensuite, pour tous les joueurs.
 */

/** 32 succès par statistique : la position tient en un entier. */
export const statBit = (entry: TopAchievement) =>
  entry.statid === undefined || entry.bit === undefined ? undefined : entry.statid * 32 + entry.bit;

interface CatalogAchievement {
  id: string;
  platformAchievementId: string;
  name: string;
  description: string;
  iconUrl: string | null;
  hidden: boolean;
  steamStatBit: number | null;
}

const same = (a: string | undefined, b: string) => (a ?? '').trim() === b.trim();
const iconOf = (url: string | null) => url?.split('/').pop() ?? '';

/** Le seul succès du catalogue qui correspond à l'entrée, ou rien s'il en reste plusieurs. */
function findByText(catalog: CatalogAchievement[], entry: TopAchievement) {
  let candidates = entry.icon ? catalog.filter((a) => iconOf(a.iconUrl) === entry.icon) : [];
  // Une icône changée depuis la dernière lecture du catalogue : le nom prend le relais, et il
  // doit alors correspondre, même s'il ne reste qu'un candidat.
  if (!candidates.length) {
    candidates = entry.name ? catalog.filter((a) => same(entry.name, a.name)) : [];
  } else if (candidates.length > 1) {
    candidates = candidates.filter((a) => same(entry.name, a.name));
  }
  // Le catalogue n'a pas la description d'un succès caché : elle ne départage que s'il l'a.
  if (candidates.length > 1) {
    candidates = candidates.filter((a) => !a.description || same(entry.desc, a.description));
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Relie les succès obtenus que Steam décrit au catalogue du jeu, et renvoie leur identifiant
 * technique. Ce qui reste ambigu est laissé : GetPlayerAchievements le dira une minute plus tard.
 * Au passage, la position des succès reconnus est retenue, et la description d'un succès caché
 * que le catalogue n'avait pas est complétée : Steam la donne à qui l'a obtenu.
 */
export async function matchTopAchievements(gameId: string, entries: TopAchievement[]) {
  const matched = new Map<TopAchievement, string>();
  if (!entries.length) return matched;
  const catalog = await db.achievement.findMany({
    where: { gameId },
    select: {
      id: true,
      platformAchievementId: true,
      name: true,
      description: true,
      iconUrl: true,
      hidden: true,
      steamStatBit: true,
    },
  });
  const byStatBit = new Map(
    catalog.flatMap((a) => (a.steamStatBit === null ? [] : [[a.steamStatBit, a] as const])),
  );

  const found = new Map<TopAchievement, CatalogAchievement>();
  for (const entry of entries) {
    const position = statBit(entry);
    const known = position === undefined ? undefined : byStatBit.get(position);
    // Un succès qui a déjà sa position ne peut pas en recevoir une autre.
    const achievement =
      known ??
      findByText(
        catalog.filter((a) => a.steamStatBit === null),
        entry,
      );
    if (achievement) found.set(entry, achievement);
  }

  // Deux entrées sur le même succès : l'une des deux est fausse, aucune n'est retenue.
  const uses = new Map<string, number>();
  for (const achievement of found.values()) {
    uses.set(achievement.id, (uses.get(achievement.id) ?? 0) + 1);
  }
  const learned: { id: string; position: number }[] = [];
  const described: { id: string; description: string }[] = [];
  for (const [entry, achievement] of found) {
    if (uses.get(achievement.id) !== 1) continue;
    matched.set(entry, achievement.platformAchievementId);
    const position = statBit(entry);
    if (position !== undefined && achievement.steamStatBit === null) {
      learned.push({ id: achievement.id, position });
    }
    if (achievement.hidden && !achievement.description && entry.desc?.trim()) {
      described.push({ id: achievement.id, description: entry.desc.trim() });
    }
  }

  if (learned.length || described.length) {
    await db.$transaction([
      ...learned.map(({ id, position }) =>
        db.achievement.updateMany({
          where: { id, steamStatBit: null },
          data: { steamStatBit: position },
        }),
      ),
      ...described.map(({ id, description }) =>
        db.achievement.updateMany({ where: { id, description: '' }, data: { description } }),
      ),
    ]);
  }
  return matched;
}
