// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { db } from './db';
import {
  BURIED_SCORE,
  GUIDE_ORDER,
  deleteGuide,
  editGuide,
  gameGuidesWhere,
  homeGuides,
  isBuried,
  voteGuide,
} from './guides';
import { renderGuide } from './markdown';
import { anchorHeadings, outlineOf } from '#lib/guide-outline';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

async function player() {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  return result.userId;
}

/** Un par un : créés en même temps, deux comptes se disputeraient le même pseudo. */
async function players(count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) ids.push(await player());
  return ids;
}

async function game(familyKey: string | null = null) {
  return db.game.create({
    data: {
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} guides`,
      slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      familyKey,
    },
  });
}

async function achievementGuide(authorId: string, extra: { curatedKey?: string } = {}) {
  const { id: gameId } = await game();
  const achievement = await db.achievement.create({
    data: { gameId, platformAchievementId: 'a', name: 'Succès' },
  });
  return db.guide.create({
    data: { achievementId: achievement.id, authorId, contentMd: 'Reste derrière.', ...extra },
  });
}

describe('votes sur les guides', () => {
  it('ne garde qu’un vote par joueur, modifiable ou annulable', async () => {
    const [author, voter] = await players(2);
    const guide = await achievementGuide(author);

    expect(await voteGuide(guide.id, voter, 1)).toEqual({ score: 1, myVote: 1 });
    // Le même vote une seconde fois le retire.
    expect(await voteGuide(guide.id, voter, 1)).toEqual({ score: 0, myVote: 0 });
    await voteGuide(guide.id, voter, 1);
    // L'inverse le remplace, sans s'ajouter.
    expect(await voteGuide(guide.id, voter, -1)).toEqual({ score: -1, myVote: -1 });
    expect(await db.guideVote.count({ where: { guideId: guide.id } })).toBe(1);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).score).toBe(-1);
  });

  it('additionne les votes de plusieurs joueurs, même simultanés', async () => {
    const author = await player();
    const voters = await players(3);
    const guide = await achievementGuide(author);

    await Promise.all(voters.map((voter) => voteGuide(guide.id, voter, 1)));
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).score).toBe(3);
  });

  it('refuse le vote sur un guide retiré', async () => {
    const [author, voter] = await players(2);
    const guide = await achievementGuide(author);
    await db.guide.update({ where: { id: guide.id }, data: { status: 'HIDDEN' } });

    expect(await voteGuide(guide.id, voter, 1)).toBeNull();
    expect(await db.guideVote.count({ where: { guideId: guide.id } })).toBe(0);
  });
});

describe('masquage des guides mal notés', () => {
  it('replie un guide sous le seuil, jamais un guide officiel', async () => {
    const author = await player();
    const guide = await achievementGuide(author);
    const voters = await players(-BURIED_SCORE);

    for (const voter of voters.slice(1)) await voteGuide(guide.id, voter, -1);
    const almost = await db.guide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(almost.score).toBe(BURIED_SCORE + 1);
    expect(isBuried(almost)).toBe(false);

    await voteGuide(guide.id, voters[0] as string, -1);
    const buried = await db.guide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(buried.score).toBe(BURIED_SCORE);
    expect(isBuried(buried)).toBe(true);
    // Replié n'est pas supprimé : il se lit toujours, et un vote pour peut le remonter.
    expect(buried.status).toBe('PUBLISHED');
    await voteGuide(guide.id, voters[0] as string, 1);
    expect(isBuried(await db.guide.findUniqueOrThrow({ where: { id: guide.id } }))).toBe(false);

    expect(isBuried({ score: -50, curatedKey: 'STEAM:1:A' })).toBe(false);
  });
});

describe('ordre des guides', () => {
  it('met les officiels en tête, puis les mieux notés, puis les plus anciens', async () => {
    const author = await player();
    const { id: gameId } = await game();
    const achievement = await db.achievement.create({
      data: { gameId, platformAchievementId: 'a', name: 'Succès' },
    });
    const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    const create = (name: string, score: number, minutes: number, curatedKey?: string) =>
      db.guide.create({
        data: {
          achievementId: achievement.id,
          authorId: author,
          contentMd: name,
          score,
          createdAt: at(minutes),
          curatedKey: curatedKey ? `${PREFIX}:${Math.random()}:${curatedKey}` : undefined,
        },
      });
    await create('récent', 3, 5);
    await create('officiel', -2, 9, 'officiel');
    await create('meilleur', 10, 8);
    await create('ancien', 3, 1);
    await create('enterré', -7, 0);

    const guides = await db.guide.findMany({
      where: { achievementId: achievement.id },
      orderBy: GUIDE_ORDER,
    });
    expect(guides.map((guide) => guide.contentMd)).toEqual([
      'officiel',
      'meilleur',
      'ancien',
      'récent',
      'enterré',
    ]);
  });
});

describe('guides de jeu', () => {
  it('porte sur un jeu ou un succès, jamais les deux ni aucun', async () => {
    const author = await player();
    const { id: gameId } = await game();
    const achievement = await db.achievement.create({
      data: { gameId, platformAchievementId: 'a', name: 'Succès' },
    });

    await expect(
      db.guide.create({ data: { authorId: author, contentMd: 'Rien' } }),
    ).rejects.toThrow();
    await expect(
      db.guide.create({
        data: { gameId, achievementId: achievement.id, authorId: author, contentMd: 'Les deux' },
      }),
    ).rejects.toThrow();
    const guide = await db.guide.create({
      data: { gameId, authorId: author, title: 'Guide 100 %', contentMd: '## Début' },
    });
    expect(guide.achievementId).toBeNull();
  });

  it('se lit depuis toutes les versions du jeu, pas depuis un autre', async () => {
    const author = await player();
    const family = `${PREFIX}-famille-${Math.random()}`;
    const [pc, console, other] = await Promise.all([game(family), game(family), game()]);
    const guide = await db.guide.create({
      data: { gameId: pc.id, authorId: author, title: 'Guide 100 %', contentMd: '## Début' },
    });
    await db.guide.create({
      data: { gameId: other.id, authorId: author, title: 'Autre', contentMd: '## Ailleurs' },
    });

    const ids = async (where: ReturnType<typeof gameGuidesWhere>) =>
      (await db.guide.findMany({ where, select: { id: true } })).map((g) => g.id);
    expect(await ids(gameGuidesWhere(console))).toEqual([guide.id]);
    expect(await ids(gameGuidesWhere(pc))).toEqual([guide.id]);
    expect(await ids(gameGuidesWhere(other))).not.toContain(guide.id);
  });

  it('se vote et se replie comme un guide de succès', async () => {
    const author = await player();
    const { id: gameId } = await game();
    const guide = await db.guide.create({
      data: { gameId, authorId: author, title: 'Guide 100 %', contentMd: '## Début' },
    });
    const voters = await players(-BURIED_SCORE);
    for (const voter of voters) await voteGuide(guide.id, voter, -1);

    expect(isBuried(await db.guide.findUniqueOrThrow({ where: { id: guide.id } }))).toBe(true);
  });

  it('ne se modifie que par son auteur, et oublie ses traductions', async () => {
    const [author, intruder] = await players(2);
    const { id: gameId } = await game();
    const guide = await db.guide.create({
      data: { gameId, authorId: author, title: 'Avant', contentMd: '## Début' },
    });
    await db.contentTranslation.create({
      data: { guideId: guide.id, locale: 'en', contentMd: '## Start' },
    });

    const as = (id: string, role = 'USER') => ({ id, role });
    expect(await editGuide(guide.id, as(intruder), { title: 'Pirate', contentMd: '…' })).toBe(
      false,
    );
    // Modérer ne donne pas la main sur le guide d'un joueur : seulement sur les officiels.
    expect(
      await editGuide(guide.id, as(intruder, 'MODERATOR'), { title: 'Pirate', contentMd: '…' }),
    ).toBe(false);
    expect(await editGuide(guide.id, as(author), { title: 'Après', contentMd: '## Fin' })).toBe(
      true,
    );
    const edited = await db.guide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(edited).toMatchObject({ title: 'Après', contentMd: '## Fin' });
    expect(await db.contentTranslation.count({ where: { guideId: guide.id } })).toBe(0);

    expect(await deleteGuide(guide.id, intruder)).toBe(false);
    expect(await deleteGuide(guide.id, author)).toBe(true);
    expect(await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).toMatchObject({
      status: 'DELETED',
      contentMd: '',
      title: null,
    });
  });

  it('numérote ses parties pour le sommaire', () => {
    const html = anchorHeadings(
      renderGuide('# Intro\n\n## Acte 1 & 2\n\n### Boss final\n\n#### Détail\n\n- [ ] Coffre'),
    );
    expect(outlineOf(html)).toEqual([
      { id: 'partie-1', level: 2, text: 'Intro' },
      { id: 'partie-2', level: 2, text: 'Acte 1 & 2' },
      { id: 'partie-3', level: 3, text: 'Boss final' },
    ]);
    expect(html).toContain('<h4>Détail</h4>');
    expect(html).toContain('data-check="0"');
  });
});

describe('derniers guides de l’accueil', () => {
  it('montre les guides de jeu officiels et ceux de la communauté bien notés', async () => {
    const author = await player();
    const { id: gameId } = await game();
    // Datés dans le futur : les guides des autres tests ne passent pas devant.
    const at = (days: number) => new Date(Date.now() + (365 + days) * 86_400_000);
    const create = (data: { title: string; score?: number; curatedKey?: string; days: number }) =>
      db.guide.create({
        data: {
          gameId,
          authorId: author,
          contentMd: 'Tout faire.',
          title: data.title,
          score: data.score ?? 0,
          curatedKey: data.curatedKey,
          createdAt: at(data.days),
        },
      });
    const official = await create({ title: 'Officiel', curatedKey: `${PREFIX}-home`, days: 1 });
    const liked = await create({ title: 'Aimé', score: 3, days: 2 });
    const unrated = await create({ title: 'Pas noté', days: 3 });
    const disliked = await create({ title: 'Mal noté', score: -2, days: 4 });
    const tip = await achievementGuide(author, { curatedKey: `${PREFIX}-home-tip` });
    await db.guide.update({ where: { id: tip.id }, data: { createdAt: at(5) } });

    const { official: officials, community } = await homeGuides();
    expect(officials[0]?.id).toBe(official.id);
    // Un guide de succès n'est pas un guide de jeu complet : il reste hors de l'accueil.
    expect(officials.map((guide) => guide.id)).not.toContain(tip.id);
    expect(community[0]?.id).toBe(liked.id);
    expect(community.map((guide) => guide.id)).not.toContain(unrated.id);
    expect(community.map((guide) => guide.id)).not.toContain(disliked.id);
  });
});
