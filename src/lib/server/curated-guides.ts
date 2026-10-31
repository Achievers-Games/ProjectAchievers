import type { Platform } from '@prisma/client';
import { db } from './db';

/** Compte fictif des guides officiels : sans compte lié, personne ne peut s'y connecter. */
const OFFICIAL_AUTHOR = {
  id: 'achievers-officiel',
  handle: 'achievers-officiel',
  displayName: 'Achievers',
  isPublic: false,
};

const FILES = import.meta.glob<string>('$lib/guides/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface GuideFile {
  platform: Platform;
  gameId: string;
  guides: { achievementId: string; content: string }[];
}

/**
 * Un fichier commence par `STEAM 367520`, puis chaque guide par `@@ IDENTIFIANT_DU_SUCCES`.
 * Tout ce qui suit est du Markdown, jusqu'au guide suivant.
 */
export function parseGuideFile(text: string): GuideFile {
  const [head = '', ...parts] = text.split(/^@@ +(\S+)[ \t]*$/m);
  const [platform, gameId] = head.trim().split(/\s+/);
  if (!platform || !gameId) throw new Error('En-tête de guide invalide');

  const guides: GuideFile['guides'] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const content = parts[index + 1]?.trim();
    if (content) guides.push({ achievementId: parts[index] as string, content });
  }
  return { platform: platform as Platform, gameId, guides };
}

/** Le dépôt fait foi : les guides officiels y sont ajoutés, modifiés ou retirés. */
export async function syncCuratedGuides(files: string[] = Object.values(FILES)) {
  await db.user.upsert({
    where: { id: OFFICIAL_AUTHOR.id },
    update: {},
    create: OFFICIAL_AUTHOR,
  });

  const keys: string[] = [];
  for (const file of files.map(parseGuideFile)) {
    const achievements = await db.achievement.findMany({
      where: { game: { platform: file.platform, platformGameId: file.gameId } },
      select: { id: true, platformAchievementId: true },
    });
    const ids = new Map(achievements.map((a) => [a.platformAchievementId, a.id]));

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
}
