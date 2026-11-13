import type { Platform, Prisma } from '#prisma';
import { logger } from '#lib/logger';
import { db } from './db';

const log = logger('Guides');

/** Compte fictif des guides officiels : sans compte lié, personne ne peut s'y connecter. */
const OFFICIAL_AUTHOR = {
  id: 'achievers-officiel',
  handle: 'achievers-officiel',
  displayName: 'Achievers',
  isPublic: false,
};

// Depuis Vite 8, un motif glob part du dossier du projet : `#lib` n'y est pas résolu.
const FILES = import.meta.glob<string>('/src/lib/guides/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Les guides complets officiels, un par jeu : à suivre du début à la fin pour le 100 %. */
const GAME_FILES = import.meta.glob<string>('/src/lib/guides/jeux/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface GameGuideFile {
  platform: Platform;
  gameId: string;
  title: string;
  content: string;
}

/**
 * Un guide complet commence par `STEAM 219150`, puis son titre en `# Titre` ; tout le reste est
 * le guide, en Markdown. Le titre devient celui de la page : il ne se répète pas dans le texte.
 */
export function parseGameGuideFile(text: string): GameGuideFile {
  const [head = '', ...lines] = text.split(/\r?\n/);
  const [platform, gameId] = head.trim().split(/\s+/);
  const titleAt = lines.findIndex((line) => line.trim() !== '');
  const title = /^#\s+(.+)$/.exec(lines[titleAt] ?? '')?.[1]?.trim();
  if (!platform || !gameId || !title) throw new Error('En-tête de guide complet invalide');
  return {
    platform: platform as Platform,
    gameId,
    title,
    content: lines
      .slice(titleAt + 1)
      .join('\n')
      .trim(),
  };
}

interface GuideFile {
  platform: Platform;
  gameId: string;
  /** Le relevé des manquables n'est pas encore complet : le site ne promet rien d'autre. */
  partial: boolean;
  guides: { achievementId: string; content: string; missable: boolean }[];
}

/**
 * Un fichier commence par `STEAM 367520`, puis chaque guide par `@@ IDENTIFIANT_DU_SUCCES`,
 * suivi de `manquable` si le succès peut être perdu pour la partie en cours.
 * Tout ce qui suit est du Markdown, jusqu'au guide suivant.
 * Un fichier vaut relevé complet des manquables du jeu : un succès non marqué ne l'est pas.
 * Sauf `STEAM 367520 partiel` : les manquables marqués comptent, sans rien garantir des autres.
 */
export function parseGuideFile(text: string): GuideFile {
  const [head = '', ...parts] = text.split(/^@@ +(\S+)(?:[ \t]+(manquable))?[ \t]*$/m);
  const [platform, gameId, flag] = head.trim().split(/\s+/);
  if (!platform || !gameId) throw new Error('En-tête de guide invalide');

  const guides: GuideFile['guides'] = [];
  for (let index = 0; index < parts.length; index += 3) {
    const content = parts[index + 2]?.trim();
    if (content) {
      guides.push({
        achievementId: parts[index] as string,
        content,
        missable: parts[index + 1] === 'manquable',
      });
    }
  }
  return { platform: platform as Platform, gameId, partial: flag === 'partiel', guides };
}

/**
 * Importe un guide officiel. Le dépôt fait foi quand **son** texte change ; tant qu'il reste le
 * même, une modification faite sur le site par un modérateur est gardée, déploiement après
 * déploiement. Si le dépôt change un guide modifié sur le site, c'est le dépôt qui l'emporte : le
 * journal le signale, pour reporter la modification dans le fichier si elle doit rester.
 */
async function importCurated(
  curatedKey: string,
  source: string,
  text: { contentMd: string; title?: string },
  create: Omit<Prisma.GuideUncheckedCreateInput, 'curatedKey' | 'curatedSource'>,
) {
  const known = await db.guide.findUnique({
    where: { curatedKey },
    select: { id: true, title: true, contentMd: true, curatedSource: true },
  });
  if (!known) {
    await db.guide.create({ data: { ...create, curatedKey, curatedSource: source } });
    return;
  }
  if (known.curatedSource === source) return;
  const same =
    known.contentMd === text.contentMd && (text.title === undefined || known.title === text.title);
  // Guide importé avant ce suivi : rien n'a pu le modifier sur le site, il suffit de noter le texte.
  if (same) {
    await db.guide.update({ where: { id: known.id }, data: { curatedSource: source } });
    return;
  }
  if (known.curatedSource !== null) {
    const edited = known.contentMd !== importedText(known.curatedSource, text.title !== undefined);
    if (edited)
      log.warn(`Guide officiel ${curatedKey} : le dépôt remplace une modification du site`);
  }
  // Une traduction de l'ancien texte ne vaut plus pour le nouveau.
  await db.contentTranslation.deleteMany({ where: { guideId: known.id } });
  await db.guide.update({ where: { id: known.id }, data: { ...text, curatedSource: source } });
}

/** Le texte d'un guide tel que le dépôt l'avait donné : sans le titre, pour un guide de jeu. */
const importedText = (source: string, withTitle: boolean) =>
  withTitle ? source.slice(source.indexOf('\n\n') + 2) : source;

/** Le dépôt fait foi : les guides officiels y sont ajoutés, modifiés ou retirés. */
export async function syncCuratedGuides(
  files: string[] = Object.values(FILES),
  gameFiles: string[] = Object.values(GAME_FILES),
) {
  await db.user.upsert({
    where: { id: OFFICIAL_AUTHOR.id },
    update: {},
    create: OFFICIAL_AUTHOR,
  });

  const keys: string[] = [];
  const covered: string[] = [];
  const reviewed: string[] = [];
  for (const file of files.map(parseGuideFile)) {
    const game = await db.game.findUnique({
      where: { platform_platformGameId: { platform: file.platform, platformGameId: file.gameId } },
      select: { id: true, guideReviewedAt: true },
    });
    if (!game) continue;
    covered.push(game.id);
    if (!file.partial) reviewed.push(game.id);
    if (file.partial === Boolean(game.guideReviewedAt)) {
      await db.game.update({
        where: { id: game.id },
        data: { guideReviewedAt: file.partial ? null : new Date() },
      });
    }
    const achievements = await db.achievement.findMany({
      where: { gameId: game.id },
      select: { id: true, platformAchievementId: true },
    });
    const ids = new Map(achievements.map((a) => [a.platformAchievementId, a.id]));
    const missable = file.guides
      .filter((guide) => guide.missable)
      .flatMap((guide) => ids.get(guide.achievementId) ?? []);
    await db.achievement.updateMany({
      where: { gameId: game.id, missable: true, id: { notIn: missable } },
      data: { missable: false },
    });
    await db.achievement.updateMany({
      where: { id: { in: missable }, missable: false },
      data: { missable: true },
    });

    for (const { achievementId: platformId, content } of file.guides) {
      const achievementId = ids.get(platformId);
      if (!achievementId) continue;
      const curatedKey = `${file.platform}:${file.gameId}:${platformId}`;
      keys.push(curatedKey);

      await importCurated(
        curatedKey,
        content,
        { contentMd: content },
        {
          achievementId,
          authorId: OFFICIAL_AUTHOR.id,
          contentMd: content,
          locale: 'fr',
        },
      );
    }
  }
  for (const file of gameFiles.map(parseGameGuideFile)) {
    const game = await db.game.findUnique({
      where: { platform_platformGameId: { platform: file.platform, platformGameId: file.gameId } },
      select: { id: true },
    });
    if (!game) continue;
    const curatedKey = `${file.platform}:${file.gameId}:JEU`;
    keys.push(curatedKey);

    await importCurated(
      curatedKey,
      `${file.title}\n\n${file.content}`,
      { title: file.title, contentMd: file.content },
      {
        gameId: game.id,
        title: file.title,
        authorId: OFFICIAL_AUTHOR.id,
        contentMd: file.content,
        locale: 'fr',
      },
    );
  }

  await db.guide.deleteMany({ where: { curatedKey: { not: null, notIn: keys } } });
  // Un fichier retiré du dépôt ne garantit plus le relevé de ses manquables.
  await db.achievement.updateMany({
    where: { missable: true, gameId: { notIn: covered } },
    data: { missable: false },
  });
  await db.game.updateMany({
    where: { guideReviewedAt: { not: null }, id: { notIn: reviewed } },
    data: { guideReviewedAt: null },
  });
}
