import type { Platform } from '@prisma/client';
import { db } from './db';

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

export interface GuideFile {
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

/** Le dépôt fait foi : les guides officiels y sont ajoutés, modifiés ou retirés. */
export async function syncCuratedGuides(files: string[] = Object.values(FILES)) {
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

      const known = await db.guide.findUnique({ where: { curatedKey } });
      if (known?.contentMd === content) continue;
      // Une traduction de l'ancien texte ne vaut plus pour le nouveau.
      if (known) await db.contentTranslation.deleteMany({ where: { guideId: known.id } });
      await db.guide.upsert({
        where: { curatedKey },
        update: { contentMd: content },
        create: {
          curatedKey,
          achievementId,
          authorId: OFFICIAL_AUTHOR.id,
          contentMd: content,
          locale: 'fr',
        },
      });
    }
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
