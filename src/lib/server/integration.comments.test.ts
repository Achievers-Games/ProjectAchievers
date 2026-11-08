// Tests sur un vrai PostgreSQL : la discussion sous un succès ou sous un guide complet de jeu.
import 'dotenv/config';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { resolveIdentity } from './accounts';
import { commentActions, loadComments, type CommentTarget } from './comments';
import { db } from './db';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

async function player() {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('compte non créé');
  return db.user.findUniqueOrThrow({ where: { id: result.userId } });
}

async function gameWithGuide() {
  const game = await db.game.create({
    data: {
      platform: 'STEAM',
      platformGameId: `${PREFIX}-discussion-${Math.random()}`,
      name: `${PREFIX} discussion`,
      slug: `${PREFIX}-discussion-${Math.random().toString(36).slice(2)}`,
    },
  });
  const author = await player();
  const guide = await db.guide.create({
    data: { gameId: game.id, title: 'Le 100 %', authorId: author.id, contentMd: 'Étapes' },
  });
  const achievement = await db.achievement.create({
    data: { gameId: game.id, platformAchievementId: 'A1', name: 'Un' },
  });
  return { game, guide, achievement };
}

/** Une action de formulaire appelée comme SvelteKit le ferait, par ce joueur. */
function event(user: { id: string } | null, fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return {
    request: new Request('http://localhost/jeux/x/guides/y', { method: 'POST', body }),
    url: new URL('http://localhost/jeux/x/guides/y'),
    locals: { user },
    params: {},
  } as unknown as RequestEvent;
}

const actionsFor = (target: CommentTarget | null) => commentActions(async () => target);

describe('discussion sous un guide complet', () => {
  it('publie un commentaire et une réponse sous le guide, et les relit', async () => {
    const { guide } = await gameWithGuide();
    const user = await player();
    const actions = actionsFor({ guideId: guide.id });

    expect(await actions.comment(event(user, { content: 'Merci pour ce guide !' }))).toMatchObject({
      success: expect.any(String),
    });
    const [first] = await db.comment.findMany({ where: { guideId: guide.id } });
    expect(first).toMatchObject({ achievementId: null, parentId: null });

    await actions.comment(event(user, { content: 'Et une réponse.', parentId: first!.id }));
    const comments = await loadComments({ guideId: guide.id }, null);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.replies.map((reply) => reply.html)).toEqual([
      expect.stringContaining('Et une réponse.'),
    ]);
  });

  it('refuse une réponse à un commentaire d’une autre page', async () => {
    const { guide, achievement } = await gameWithGuide();
    const user = await player();
    await actionsFor({ achievementId: achievement.id }).comment(
      event(user, { content: 'Sous le succès.' }),
    );
    const [elsewhere] = await db.comment.findMany({ where: { achievementId: achievement.id } });

    const reply = await actionsFor({ guideId: guide.id }).comment(
      event(user, { content: 'Réponse égarée.', parentId: elsewhere!.id }),
    );
    expect(reply).toMatchObject({ status: 404 });
    expect(await db.comment.count({ where: { guideId: guide.id } })).toBe(0);
  });

  it('ne publie rien sur un guide disparu ni sans être connecté', async () => {
    const user = await player();
    expect(await actionsFor(null).comment(event(user, { content: 'Dans le vide.' }))).toMatchObject(
      { status: 404 },
    );
    await expect(
      actionsFor(null).comment(event(null, { content: 'Anonyme.' })),
    ).rejects.toMatchObject({ status: 303 });
  });

  it('garde les commentaires du guide à part de ceux des succès, et les efface avec lui', async () => {
    const { guide, achievement } = await gameWithGuide();
    const user = await player();
    await actionsFor({ guideId: guide.id }).comment(event(user, { content: 'Sur le guide.' }));
    await actionsFor({ achievementId: achievement.id }).comment(
      event(user, { content: 'Sur le succès.' }),
    );

    expect((await loadComments({ guideId: guide.id }, null)).map((c) => c.html)).toEqual([
      expect.stringContaining('Sur le guide.'),
    ]);
    await db.guide.delete({ where: { id: guide.id } });
    expect(await db.comment.count({ where: { guideId: guide.id } })).toBe(0);
    expect(await db.comment.count({ where: { achievementId: achievement.id } })).toBe(1);
  });

  it('refuse en base un commentaire qui viserait deux choses à la fois', async () => {
    const { guide, achievement } = await gameWithGuide();
    const user = await player();
    await expect(
      db.comment.create({
        data: {
          guideId: guide.id,
          achievementId: achievement.id,
          authorId: user.id,
          contentMd: 'Les deux ?',
        },
      }),
    ).rejects.toThrow();
  });
});
