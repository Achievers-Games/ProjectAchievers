import type { Platform } from '#prisma';
import { plainText } from '#lib/guide-outline';
import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import { ensureGameTexts } from './achievement-texts';
import { db } from './db';
import { renderGuide } from './markdown';
import { sameName } from './same-name';

interface LinkedGame {
  id: string;
  platform: Platform;
  platformGameId: string;
  familyKey: string | null;
}

/** Un nom sans aucune lettre (« 1001% ») se compare tel quel : « 30 » n'est pas « 30 % ». */
const nameKey = (name: string) => {
  const key = sameName(name);
  return /\p{L}/u.test(key) ? key : name.trim();
};

type Resolve = (name: string) => string | null;

const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Le contenu d'un lien est passé d'un bloc : un succès n'y ajoute pas un lien dans le lien.
const BOLD = /<a\b[^>]*>[\s\S]*?<\/a>|<strong>([\s\S]*?)<\/strong>/g;

const boldIds = (html: string, resolve: Resolve) =>
  [...html.matchAll(BOLD)].flatMap(([, inner]) =>
    inner === undefined ? [] : [inner.includes('<a ') ? null : resolve(plainText(inner))],
  );

/**
 * Relie chaque succès nommé en gras à sa page. `reference` est le texte d'origine du guide : une
 * traduction (ou le filtre de vocabulaire) change les noms, mais garde les passages en gras dans
 * le même ordre. Si un nom reconnu dit le contraire, l'ordre ne sert plus à rien.
 */
export function linkAchievements(
  html: string,
  resolve: Resolve,
  {
    reference,
    except,
    names,
  }: {
    reference?: string;
    except?: string;
    names?: ReadonlyMap<string, string>;
  } = {},
): string {
  let ids = boldIds(html, resolve);
  if (reference !== undefined) {
    const original = boldIds(reference, resolve);
    const aligned =
      original.length === ids.length && ids.every((id, rank) => !id || id === original[rank]);
    if (aligned) ids = original;
  }
  let rank = 0;
  return html.replace(BOLD, (match, inner: string | undefined) => {
    if (inner === undefined) return match;
    const id = ids[rank++];
    if (!id || inner.includes('<a ')) return match;
    // On ne remplace qu'un intitulé identifié directement, jamais une correspondance déduite
    // de sa position dans le texte traduit.
    const name = resolve(plainText(inner)) === id ? names?.get(id) : undefined;
    const label = name ? `<strong>${escapeText(name)}</strong>` : match;
    if (id === except) return label;
    // Sans `?caches` : la page d'un succès caché reste masquée pour qui ne l'a pas débloqué.
    return `<a href="/succes/${id}">${label}</a>`;
  });
}

/** Les succès de chaque nom ; un nom porté par deux succès ne désigne personne. */
export function nameIndex(achievements: { id: string; names: string[] }[]): Resolve {
  const index = new Map<string, string | null>();
  for (const { id, names } of achievements) {
    for (const key of new Set(names.map(nameKey))) {
      if (!key) continue;
      const known = index.get(key);
      index.set(key, known === undefined || known === id ? id : null);
    }
  }
  return (name) => index.get(nameKey(name)) ?? null;
}

/**
 * Prépare les liens d'un guide officiel lu depuis `game`. Les guides nomment les succès en
 * français ou en anglais selon le jeu ; une version sans ces textes (Xbox) passe par le succès de
 * même nom d'une autre version. La fonction rendue ajoute les liens au HTML d'un texte du guide.
 */
export async function guideLinks(
  game: LinkedGame,
  locale: Locale,
  except?: string,
): Promise<(html: string, source: string) => string> {
  const family = game.familyKey
    ? await db.game.findMany({
        where: { familyKey: game.familyKey, id: { not: game.id } },
        select: { id: true, platform: true, platformGameId: true },
      })
    : [];
  const texts = [game, ...family.filter((version) => version.platform === 'STEAM')];
  const wantedLocales = [...new Set([baseLocale, 'en', locale] as const)];
  await Promise.all(
    texts.flatMap((version) => wantedLocales.map((wanted) => ensureGameTexts(version, wanted))),
  );

  const achievements = (
    await db.achievement.findMany({
      where: { gameId: { in: [game.id, ...family.map((version) => version.id)] } },
      select: {
        id: true,
        gameId: true,
        name: true,
        translations: {
          where: { locale: { in: wantedLocales } },
          select: { locale: true, name: true },
        },
      },
    })
  ).map(({ id, gameId, name, translations }) => ({
    id,
    gameId,
    names: [name, ...translations.map((text) => text.name)],
    platformName: name,
    localizedName: translations.find((text) => text.locale === locale)?.name,
  }));

  const own = nameIndex(achievements.filter((achievement) => achievement.gameId === game.id));
  const others = family.map((version) => {
    const list = achievements.filter((achievement) => achievement.gameId === version.id);
    return { find: nameIndex(list), names: new Map(list.map((item) => [item.id, item.names])) };
  });
  const resolve: Resolve = (name) => {
    const direct = own(name);
    if (direct) return direct;
    for (const { find, names } of others) {
      const id = find(name);
      const aliases = id ? (names.get(id) ?? []) : [];
      const match = aliases.map(own).find((found) => found !== null);
      if (match) return match;
    }
    return null;
  };

  const platformUsesBaseLocale = game.platform === 'STEAM' || game.platform === 'BLIZZARD';
  const localized = new Map(
    achievements.flatMap(({ id, gameId, localizedName, platformName }) => {
      if (gameId !== game.id) return [];
      const name =
        localizedName || (locale === baseLocale && platformUsesBaseLocale ? platformName : '');
      return name ? [[id, name] as const] : [];
    }),
  );

  return (html, source) =>
    linkAchievements(html, resolve, { reference: renderGuide(source), except, names: localized });
}
