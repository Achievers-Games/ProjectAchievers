import { Prisma, type Platform } from '#prisma';
import { m } from '#lib/paraglide/messages';
import {
  CLAN_CODES,
  EVENT_CODES,
  SECRET_CODES,
  SITE_CATEGORIES,
  SITE_CODES,
  genreOf,
  groupSeries,
  seriesOf,
  stepTier,
  tierOf,
  type BaseCode,
  type ClanKey,
  type SiteCode,
} from '#lib/site-achievements';
import { getLocale } from '#lib/paraglide/runtime';
import { localizeAchievements } from './achievement-texts';
import { checkClanAchievements, clanFacts } from './clan-achievements';
import { rateLimit } from './rate-limit';
import { logger } from '#lib/logger';
import { db } from './db';
import {
  GENRE_ICON,
  ICON_PATHS,
  SERIES_ICON,
  SITE_ICON,
  UNKNOWN_ICON,
  type IconName,
} from './site-icons';
import { publicGames, visibleGames } from './queries';
import { publishChat } from './sync/events';
import { evaluateSite, type SiteProof } from './site-rules';
import { GAME_PLAYER, GAME_PROVIDERS, loadFacts } from './site-facts';

const log = logger('Succès du site');
const SECRETS_FOR_LAST_WORD = 10;
const CLAN_CHECK_EVERY = 10 * 60 * 1000;

/**
 * Attribue ce qui est mérité. Un succès obtenu reste acquis ; la toute première évaluation
 * reste muette, pour ne pas inonder un joueur qui arrive avec tout son historique.
 */
export async function checkSiteAchievements(userId: string) {
  // Le clan se relit avec ses membres, mais pas à chaque synchro de chacun d'eux.
  const member = await db.clanMember.findUnique({ where: { userId }, select: { clanId: true } });
  if (member && rateLimit(`clan-succes:${member.clanId}`, 1, CLAN_CHECK_EVERY)) {
    await checkClanAchievements(member.clanId).catch((cause) =>
      log.error('Succès de clan :', cause),
    );
  }
  const rows = await db.siteUnlock.findMany({
    where: { userId },
    select: { code: true, proof: true },
  });
  const earned = new Set(rows.map((row) => row.code));
  const unexplained = rows.filter((row) => row.proof === null).map((row) => row.code);
  const settled = new Set(rows.filter((row) => row.proof !== null).map((row) => row.code));
  const facts = await loadFacts(userId, settled);
  if (!facts) return [];

  const { codes, proof } = evaluateSite(facts);
  const gained = codes.filter((code) => !earned.has(code));
  const secrets = [...earned, ...gained].filter((code) => SECRET_CODES.has(code)).length;
  if (secrets >= SECRETS_FOR_LAST_WORD && !earned.has('last_word')) gained.push('last_word');

  const json = (code: string) =>
    (proof(code as SiteCode) ?? undefined) as Prisma.InputJsonValue | undefined;
  // Un succès obtenu avant l'enregistrement des preuves reçoit la sienne dès qu'elle se retrouve.
  const explained = unexplained.filter((code) => json(code) !== undefined);
  await Promise.all(
    explained.map((code) =>
      db.siteUnlock.update({
        where: { userId_code: { userId, code } },
        data: { proof: json(code) },
      }),
    ),
  );
  if (!gained.length) return gained;

  await db.siteUnlock.createMany({
    data: gained.map((code) => ({ userId, code, proof: json(code) })),
    skipDuplicates: true,
  });
  if (rows.length > 0) publishChat(userId, { type: 'site-achievement', codes: gained });
  return gained;
}

/** Un joueur qui ne revient pas reçoit quand même ses succès : le site les calcule pour lui. */
export async function reviewNewPlayers() {
  const players = await db.user.findMany({
    where: { ...GAME_PLAYER, siteUnlocks: { none: {} } },
    select: { id: true },
  });
  for (const { id } of players) await checkSiteAchievements(id);
}

/** Pour les gestes qui ne laissent aucune trace à relire : un clan quitté, un pseudo changé. */
export async function grantSiteAchievement(userId: string, code: SiteCode) {
  const { count } = await db.siteUnlock.createMany({
    data: [{ userId, code }],
    skipDuplicates: true,
  });
  if (count > 0) publishChat(userId, { type: 'site-achievement', codes: [code] });
}

type Message = (params?: Record<string, string | number>) => string;
const TEXTS = m as unknown as Record<string, Message | undefined>;
/** Les clés sont construites à partir des codes : la table reste dynamique, mais sans assertion. */
const message = (key: string, params?: Record<string, string | number>) =>
  TEXTS[key]?.(params) ?? key;
/** Les paliers d'une série d'amis ou de clan partagent un titre. */
const siteTitle = (code: string) => message(`ach_${seriesOf(code)?.key ?? code}_title`);

/** Les genres partagent un modèle de texte ; les autres succès ont le leur. */
function siteText(code: string) {
  const series = seriesOf(code);
  if (series) return message(`ach_${series.key}_text`, { count: series.count });
  const genre = genreOf(code);
  if (!genre) return message(`ach_${code}_text`);
  const params = { genre: message(`genre_${genre.key}`), count: genre.count };
  return message(genre.count === 1 ? 'ach_genre_one_text' : 'ach_genre_many_text', params);
}

const iconOf = (code: string): IconName => {
  const genre = genreOf(code);
  const series = seriesOf(code);
  if (genre) return GENRE_ICON[genre.key];
  return series ? SERIES_ICON[series.key] : SITE_ICON[code as BaseCode];
};
const CATEGORY_OF = new Map(
  Object.entries(SITE_CATEGORIES).flatMap(([category, codes]) =>
    codes.map((code) => [code as string, category]),
  ),
);

/** Ce qu'il faut pour fêter un succès à l'écran : il appartient déjà au joueur. */
export const sitePop = (code: string) => ({
  title: siteTitle(code),
  icon: ICON_PATHS[iconOf(code)],
  category: CATEGORY_OF.get(code) ?? 'start',
  level: genreOf(code)?.level ?? seriesOf(code)?.level ?? 0,
  tier: tierOf(code),
});

export const siteAchievementCount = (userId: string) =>
  db.siteUnlock.count({ where: { userId, code: { notIn: [...EVENT_CODES] } } });

/**
 * Retrouve les noms derrière les preuves, sans montrer un jeu adulte à qui les masque. Un ami dont
 * le profil est privé ne se nomme que sur son propre tableau.
 */
async function proofLabels(proofs: SiteProof[], showAdult: boolean, own: boolean) {
  // Un jeu Steam pas encore classé pourrait être adulte : il reste hors des preuves publiques.
  const game = showAdult ? {} : publicGames;
  const [games, achievements, users, clans] = await Promise.all([
    db.game.findMany({
      where: { id: { in: proofs.flatMap((proof) => proof.games ?? []) }, ...game },
      select: { id: true, name: true, slug: true, coverUrl: true, headerUrl: true },
    }),
    db.achievement.findMany({
      where: { id: { in: proofs.flatMap((proof) => proof.achievements ?? []) }, game },
      select: { id: true, name: true, iconUrl: true, game: { select: { name: true } } },
    }),
    db.user.findMany({
      where: {
        id: { in: proofs.flatMap((proof) => proof.users ?? []) },
        ...(own ? {} : { isPublic: true }),
      },
      select: { id: true, handle: true, displayName: true, avatarUrl: true },
    }),
    db.clan.findMany({
      where: { id: { in: proofs.flatMap((proof) => proof.clans ?? []) } },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  const localized = await localizeAchievements(achievements, getLocale());
  return {
    games: new Map(games.map((row) => [row.id, row])),
    achievements: new Map(localized.map((row) => [row.id, row])),
    users: new Map(users.map((row) => [row.id, row])),
    clans: new Map(clans.map((row) => [row.id, row])),
  };
}

/** Le tableau d'un joueur. Un secret ne se lit qu'une fois obtenu par celui qui regarde. */
export async function siteAchievementBoard(
  userId: string,
  viewerId: string | null,
  showAdult = false,
) {
  const [owned, viewed, counts, players] = await Promise.all([
    db.siteUnlock.findMany({
      where: { userId },
      select: { code: true, unlockedAt: true, proof: true },
    }),
    viewerId ? db.siteUnlock.findMany({ where: { userId: viewerId }, select: { code: true } }) : [],
    db.siteUnlock.groupBy({ by: ['code'], _count: { _all: true } }),
    db.user.count({ where: GAME_PLAYER }),
  ]);
  const dates = new Map(owned.map((row) => [row.code, row.unlockedAt]));
  const seen = new Set(viewed.map((row) => row.code));
  const holders = new Map(counts.map((row) => [row.code, row._count._all]));
  // Un joueur qui a délié ses comptes garde ses succès : le total peut dépasser la base.
  const share = (code: string) =>
    Math.min(100, ((holders.get(code) ?? 0) / Math.max(1, players)) * 100);
  const revealedCode = (code: string) => !SECRET_CODES.has(code) || seen.has(code);
  const proofs = new Map(
    owned
      .filter((row) => row.proof !== null && revealedCode(row.code))
      .map((row) => [row.code, row.proof as SiteProof]),
  );
  const labels = await proofLabels([...proofs.values()], showAdult, viewerId === userId);
  const proofOf = (code: string) => {
    const proof = proofs.get(code);
    const games = (proof?.games ?? []).flatMap((id) => labels.games.get(id) ?? []);
    const achievements = (proof?.achievements ?? []).flatMap(
      (id) => labels.achievements.get(id) ?? [],
    );
    const users = (proof?.users ?? []).flatMap((id) => labels.users.get(id) ?? []);
    const clans = (proof?.clans ?? []).flatMap((id) => labels.clans.get(id) ?? []);
    return games.length || achievements.length || users.length || clans.length
      ? { games, achievements, users, clans }
      : null;
  };

  let index = 0;
  const icons = new Set<IconName>([UNKNOWN_ICON]);
  const categories = Object.entries(SITE_CATEGORIES).map(([category, codes]) => ({
    category,
    earned: codes.filter((code) => dates.has(code)).length,
    size: codes.length,
    // Les paliers d'un même succès forment une carte : le dernier obtenu, puis le suivant à viser.
    items: groupSeries(codes as readonly string[]).map((steps) => {
      const reached = steps.findLastIndex((code) => dates.has(code));
      const target = steps.find((code) => !dates.has(code)) ?? steps.at(-1)!;
      // La carte parle du palier obtenu ; tant qu'aucun ne l'est, de celui à viser.
      const shownCode = reached >= 0 ? steps[reached]! : target;
      const revealed = revealedCode(target);
      const icon = revealed ? iconOf(target) : UNKNOWN_ICON;
      icons.add(icon);
      const complete = dates.has(target);
      return {
        // Le numéro n'apprend rien, contrairement au code d'un secret.
        key: index++,
        code: revealed ? target : null,
        // Les codes de tous ses paliers : une annonce de succès mène à cette carte, quel que soit le palier.
        anchors: revealed ? steps : [],
        title: revealed ? siteTitle(shownCode) : null,
        text: revealed ? siteText(shownCode) : null,
        // Le palier suivant, une fois le premier obtenu : la carte dit d'où on part et où aller.
        next: revealed && reached >= 0 && !complete ? siteText(target) : null,
        // La date et la couleur sont celles du dernier palier obtenu.
        unlockedAt: reached >= 0 ? (dates.get(steps[reached]!) ?? null) : null,
        complete,
        icon,
        tier: revealed && reached >= 0 ? stepTier(reached, steps.length) : 0,
        proof: reached >= 0 ? proofOf(steps[reached]!) : null,
        // Comme la date : la part des joueurs qui ont le palier obtenu, pas celui à viser.
        rarity: revealed ? share(reached >= 0 ? steps[reached]! : target) : null,
        // Seul le joueur lui-même reçoit des idées de jeux, chargées à la demande.
        suggest: userId === viewerId && !dates.has(target) && suggestable(target),
        steps:
          steps.length > 1
            ? steps.map((code, at) => ({
                title: siteTitle(code),
                earned: dates.has(code),
                tier: stepTier(at, steps.length),
              }))
            : [],
      };
    }),
  }));
  const permanent = SITE_CODES.filter((code) => !EVENT_CODES.has(code));
  return {
    categories,
    // Chaque dessin ne part qu'une fois, même partagé par plusieurs succès.
    icons: Object.fromEntries([...icons].map((name) => [name, ICON_PATHS[name]])),
    earned: permanent.filter((code) => dates.has(code)).length,
    total: permanent.length,
  };
}

const SUGGESTED = 3;
/** Ces succès se gagnent en finissant n'importe quel jeu : le plus avancé est le meilleur choix. */
const ANY_FINISH = /^(cards_\d+|game_\d+|season_finish_\d+)$/;
const suggestable = (code: string) => genreOf(code) !== null || ANY_FINISH.test(code);

/**
 * Les jeux qui rapprochent d'un succès du site : d'abord ceux de la bibliothèque, du plus avancé
 * au moins avancé ; sinon les plus joués du site, sur une plateforme déjà liée.
 */
export async function siteSuggestions(userId: string, code: string, showAdult = false) {
  const genre = genreOf(code);
  if (!suggestable(code)) return null;
  const game = {
    ...visibleGames(showAdult),
    ...(genre ? { tags: { hasSome: [...genre.tags] } } : {}),
    totalAchievements: { gt: 0 },
  } satisfies Prisma.GameWhereInput;
  const gameSelect = { name: true, slug: true, coverUrl: true, headerUrl: true } as const;

  const mine = await db.userGame.findMany({
    where: { userId, hidden: false, completion: { lt: 100 }, game },
    orderBy: [{ completion: 'desc' }, { unlockedCount: 'desc' }],
    take: SUGGESTED,
    select: {
      completion: true,
      unlockedCount: true,
      totalCount: true,
      game: { select: gameSelect },
    },
  });
  if (mine.length || !genre) {
    return {
      owned: true,
      games: mine.map((row) => ({
        ...row.game,
        completion: row.completion,
        left: Math.max(0, row.totalCount - row.unlockedCount),
      })),
    };
  }

  const accounts = await db.linkedAccount.findMany({
    where: { userId, provider: { in: GAME_PROVIDERS } },
    select: { provider: true },
  });
  const platforms = [...new Set(accounts.map((account) => account.provider))] as Platform[];
  const others = await db.game.findMany({
    where: { ...game, platform: { in: platforms }, players: { none: { userId } } },
    orderBy: { players: { _count: 'desc' } },
    take: SUGGESTED,
    select: { ...gameSelect, totalAchievements: true },
  });
  return {
    owned: false,
    games: others.map(({ totalAchievements, ...row }) => ({
      ...row,
      completion: null,
      left: totalAchievements,
    })),
  };
}

/** Les succès d'un clan, avec l'avancée de chaque série ; un secret n'apparaît qu'une fois gagné. */
export async function clanAchievementBoard(clanId: string) {
  const [owned, facts] = await Promise.all([
    db.clanUnlock.findMany({ where: { clanId }, select: { code: true, unlockedAt: true } }),
    clanFacts(clanId),
  ]);
  const dates = new Map(owned.map((row) => [row.code, row.unlockedAt]));
  const secrets = [...CLAN_CODES].filter((code) => SECRET_CODES.has(code) && dates.has(code));
  const icons = new Set<IconName>();
  const items = groupSeries([...SITE_CATEGORIES.clan, ...secrets]).map((steps) => {
    const reached = steps.findLastIndex((code) => dates.has(code));
    const target = steps.find((code) => !dates.has(code)) ?? steps.at(-1)!;
    const series = seriesOf(target);
    const icon = iconOf(target);
    icons.add(icon);
    const shownCode = reached >= 0 ? steps[reached]! : target;
    const complete = dates.has(target);
    return {
      code: target,
      title: siteTitle(shownCode),
      text: siteText(shownCode),
      next: reached >= 0 && !complete ? siteText(target) : null,
      icon,
      secret: SECRET_CODES.has(target),
      unlockedAt: reached >= 0 ? (dates.get(steps[reached]!) ?? null) : null,
      complete,
      tier: reached >= 0 ? stepTier(reached, steps.length) : 0,
      // L'avancée vers le palier visé : 1 234 succès sur 10 000.
      progress:
        series && facts && !dates.has(target)
          ? { value: facts.counts[series.key as ClanKey], goal: series.count }
          : null,
      steps:
        steps.length > 1
          ? steps.map((code, at) => ({
              title: siteText(code),
              earned: dates.has(code),
              tier: stepTier(at, steps.length),
            }))
          : [],
    };
  });
  const permanent = SITE_CATEGORIES.clan as readonly string[];
  return {
    items,
    icons: Object.fromEntries([...icons].map((name) => [name, ICON_PATHS[name]])),
    earned: permanent.filter((code) => dates.has(code)).length,
    total: permanent.length,
  };
}
