// Tests sur un vrai PostgreSQL : les liens d'un guide officiel vers les succès qu'il nomme.
import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '#prisma';
import { paraglideMiddleware } from '#lib/paraglide/server';
import silksong from '#lib/guides/jeux/hollow-knight-silksong.md?raw';
import { db } from './db';
import { syncCuratedGuides } from './curated-guides';
import { editGuide } from './guides';
import { guideLinks, linkAchievements, nameIndex } from './guide-links';
import { renderGuide } from './markdown';
import { PREFIX, setupIntegration } from './test-helpers';
import { load as loadGuide } from '../../routes/jeux/[slug]/guides/[id]/+page.server';
import { load as loadAchievement } from '../../routes/succes/[id]/+page.server';

setupIntegration();

const resolve = nameIndex([
  { id: 'a', names: ['Au travail', 'Back to Work'] },
  { id: 'b', names: ['Dépoussiérage', 'Dusty'] },
  { id: 'c', names: ['Doublon'] },
  { id: 'd', names: ['Doublon'] },
  { id: 'e', names: ['1001%'] },
]);
const link = (md: string, options?: Parameters<typeof linkAchievements>[2]) =>
  linkAchievements(renderGuide(md), resolve, options);

describe('succès nommés dans un texte', () => {
  it('relie un succès en gras, dans l’une ou l’autre langue, ponctuation comprise ou non', () => {
    expect(link('**Back to Work**')).toContain(
      '<a href="/succes/a"><strong>Back to Work</strong></a>',
    );
    expect(link('- [ ] **au travail :** vite')).toContain('<a href="/succes/a">');
    expect(link('**1001%** puis **1001**').match(/<a /g)).toHaveLength(1);
  });

  it('laisse en texte simple un nom inconnu, ambigu, ou qui n’est pas en gras', () => {
    const html = link('**Inconnu**, **Doublon**, Dusty, `**Dusty**`');
    expect(html).not.toContain('<a ');
  });

  it('ne met pas un lien dans un lien, ni vers la page déjà ouverte', () => {
    expect(link('[**Dusty**](https://exemple.fr)').match(/<a /g)).toHaveLength(1);
    expect(link('**[Dusty](https://exemple.fr)**').match(/<a /g)).toHaveLength(1);
    expect(link('**Dusty**', { except: 'b' })).not.toContain('<a ');
  });

  it('garde le rang des cases à cocher', () => {
    const md = '- [ ] **Dusty**\n- [ ] Rien\n- [ ] **Back to Work**';
    const boxes = (html: string) => html.match(/data-check="\d+"/g);
    expect(boxes(link(md))).toEqual(boxes(renderGuide(md)));
  });

  it('suit l’ordre du texte d’origine quand la traduction a changé les noms', () => {
    const reference = renderGuide('**Dusty**, **astuce**, **Back to Work**');
    const html = link('**Staubig**, **Tipp**, **Zurück an die Arbeit**', { reference });
    expect(html).toContain('<a href="/succes/b"><strong>Staubig</strong></a>');
    expect(html).toContain('<a href="/succes/a"><strong>Zurück an die Arbeit</strong></a>');
    expect(html).not.toContain('<a href="/succes/b"><strong>Tipp');
    // Un passage en plus, ou un nom reconnu ailleurs : l'ordre ne prouve plus rien.
    expect(link('**Staubig**, **Arbeit**', { reference })).not.toContain('<a ');
    expect(link('**Back to Work**, **Tipp**, **Staubig**', { reference })).not.toContain(
      'Staubig</strong></a>',
    );
  });
});

async function version(platform: Platform, familyKey: string | null) {
  const id = `${PREFIX}-liens-${Math.random().toString(36).slice(2)}`;
  const game = await db.game.create({
    data: { platform, platformGameId: id, name: `${PREFIX} liens`, slug: id, familyKey },
  });
  // Textes déjà demandés à la plateforme : le test n'a pas besoin du réseau.
  await db.gameTranslation.createMany({
    data: ['fr', 'en'].map((locale) => ({ gameId: game.id, locale })),
  });
  return game;
}

const achievement = (
  gameId: string,
  platformAchievementId: string,
  name: string,
  extra: { hidden?: boolean; english?: string } = {},
) =>
  db.achievement.create({
    data: {
      gameId,
      platformAchievementId,
      name,
      hidden: extra.hidden ?? false,
      ...(extra.english && {
        translations: { create: { locale: 'en', name: extra.english } },
      }),
    },
  });

const visit = (path: string) => ({
  locals: {},
  url: new URL(`https://achievers.test${path}`),
  depends: vi.fn(),
  setHeaders: vi.fn(),
});

describe('liens d’un guide officiel', () => {
  it('sert l’édition de l’adresse avec les cases du lecteur et ignore les traductions en cache', async () => {
    const slug = `${PREFIX}-editions-silksong`;
    const game = await db.game.create({
      data: { platform: 'STEAM', platformGameId: '1030300', name: slug, slug },
    });
    await db.gameTranslation.createMany({
      data: ['fr', 'en', 'es'].map((locale) => ({ gameId: game.id, locale })),
    });
    await syncCuratedGuides([], [silksong]);
    const guide = await db.guide.findFirstOrThrow({ where: { gameId: game.id } });
    const user = await db.user.create({
      data: { handle: `${PREFIX}-lecteur-editions`, displayName: 'Lecteur' },
    });
    await db.guideCheck.create({ data: { guideId: guide.id, userId: user.id, item: 12 } });
    await db.contentTranslation.create({
      data: { guideId: guide.id, locale: 'de', contentMd: 'Traduction automatique en cache' },
    });

    const open = async (locale: string) => {
      const event = visit(`/${locale}/jeux/${slug}/guides/${guide.id}`);
      const response = await paraglideMiddleware(new Request(event.url), async () => {
        const page = await loadGuide({
          ...event,
          params: { slug, id: guide.id },
          locals: { user },
        } as never);
        if (!page) throw new Error('Données du guide absentes');
        return Response.json(page.guide);
      });
      return response.json();
    };
    const spanish = await open('es');
    expect(spanish).toMatchObject({ locale: 'es', id: guide.id, checked: [12], steps: 51 });
    expect(spanish.html).toContain('Campanilla');
    const fallback = await open('de');
    expect(fallback).toMatchObject({
      locale: 'fr',
      id: guide.id,
      checked: [12],
      autoTranslate: false,
      translatedHtml: null,
    });
    expect(fallback.html).toContain('Clochelle');
    await syncCuratedGuides([], []);
  });

  it('mène aux succès de la version ouverte, par son nom ou par celui d’une autre version', async () => {
    const familyKey = `${PREFIX}-liens-famille`;
    const steam = await version('STEAM', familyKey);
    const xbox = await version('XBOX', familyKey);
    const onSteam = await achievement(steam.id, 'S1', 'Au travail', { english: 'Back to Work' });
    const steamOnly = await achievement(steam.id, 'S2', 'Seulement ici');
    const onXbox = await achievement(xbox.id, 'X1', 'Au travail');
    const md = '**Back to Work**, **Seulement ici**, **Jamais vu**';

    const fromSteam = (await guideLinks(steam, 'fr'))(renderGuide(md), md);
    expect(fromSteam).toContain(`<a href="/succes/${onSteam.id}"><strong>Au travail`);
    expect(fromSteam).toContain(`<a href="/succes/${steamOnly.id}">`);
    expect(fromSteam).not.toContain('<a href="/succes/undefined');
    expect(fromSteam.match(/<a /g)).toHaveLength(2);

    // La version Xbox n'a pas de nom anglais : il passe par le succès Steam du même nom français.
    const fromXbox = (await guideLinks(xbox, 'fr'))(renderGuide(md), md);
    expect(fromXbox).toContain(`<a href="/succes/${onXbox.id}"><strong>Back to Work`);
    expect(fromXbox.match(/<a /g)).toHaveLength(1);
  });

  it('mène à un succès caché sans le dévoiler, et garde le texte du modérateur intact', async () => {
    const game = await version('STEAM', null);
    const secret = await achievement(game.id, 'S1', 'Grand secret', { hidden: true });
    await syncCuratedGuides(
      [],
      [`STEAM ${game.platformGameId}\n\n# Le 100 %\n\n- [ ] La fin : **Grand secret**\n`],
    );
    const guide = await db.guide.findFirstOrThrow({ where: { gameId: game.id } });
    const open = async () => {
      const path = `/jeux/${game.slug}/guides/${guide.id}`;
      const event = { ...visit(path), params: { slug: game.slug, id: guide.id } };
      return (await loadGuide(event as never)) as { guide: { html: string } };
    };
    const anchor = `<a href="/succes/${secret.id}"><strong>Grand secret</strong></a>`;
    expect((await open()).guide.html).toContain(anchor);

    const moderator = { id: `${PREFIX}-moderateur`, role: 'MODERATOR' };
    const contentMd = '- [ ] Corrigé : **Grand secret**';
    expect(await editGuide(guide.id, moderator, { contentMd })).toBe(true);
    expect((await open()).guide.html).toContain(anchor);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).contentMd).toBe(
      contentMd,
    );

    // Le lien ouvre la page masquée : le succès reste à dévoiler par le lecteur.
    const page = (await loadAchievement({
      ...visit(`/succes/${secret.id}`),
      params: { id: secret.id },
    } as never)) as { masked: boolean; achievement: { name: string } };
    expect(page.masked).toBe(true);
    expect(page.achievement.name).not.toBe('Grand secret');
    await syncCuratedGuides([], []);
  });

  it('ne relie que les guides officiels', async () => {
    const game = await version('STEAM', null);
    await achievement(game.id, 'S1', 'Au travail');
    const author = await db.user.create({
      data: { handle: `${PREFIX}-auteur-liens`, displayName: 'Auteur' },
    });
    const guide = await db.guide.create({
      data: { gameId: game.id, authorId: author.id, title: 'Le mien', contentMd: '**Au travail**' },
    });
    const { guide: shown } = (await loadGuide({
      ...visit(`/jeux/${game.slug}/guides/${guide.id}`),
      params: { slug: game.slug, id: guide.id },
    } as never)) as { guide: { html: string } };
    expect(shown.html).not.toContain('<a ');
  });

  it('relie les autres succès nommés par le guide d’un succès, pas le sien', async () => {
    const game = await version('STEAM', null);
    const one = await achievement(game.id, 'S1', 'Le fusil');
    const two = await achievement(game.id, 'S2', 'L’épée');
    await syncCuratedGuides([
      `STEAM ${game.platformGameId}\n\n@@ S1\n**Le fusil** avant **L'épée**.\n`,
    ]);
    const page = (await loadAchievement({
      ...visit(`/succes/${one.id}`),
      params: { id: one.id },
    } as never)) as { guides: { html: string }[] };
    expect(page.guides[0]?.html).toContain(`<a href="/succes/${two.id}">`);
    expect(page.guides[0]?.html).not.toContain(`/succes/${one.id}`);
    await syncCuratedGuides([]);
  });
});
