import { CLAN_SERIES, GENRES, type ClanCode, type ClanKey } from '$lib/site-achievements';
import { clanFrameFor, CLAN_FRAMES } from '$lib/frames';
import { SEASON } from '$lib/season';
import { m } from '$lib/paraglide/messages';
import { db } from './db';
import { logger } from '$lib/logger';
import { notify } from './push';

const log = logger('Succès de clan');
import { publishChat } from './sync/events';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;
/** Les succès qui demandent à chacun de participer n'ont de sens qu'à trois au moins. */
const TOGETHER = 3;
const GHOST_DAYS = 30;

/** Où en est un clan : un compte par série, et les succès sans palier. */
export interface ClanFacts {
  counts: Record<ClanKey, number>;
  nobodyBehind: boolean;
  loyal: boolean;
  insomniacs: boolean;
  ghost: boolean;
}

const dayNumber = (date: Date) => Math.floor(date.getTime() / DAY);
/** Les semaines commencent le lundi : le 1er janvier 1970 était un jeudi. */
const weekNumber = (day: number) => Math.floor((day + 3) / 7);

function longestRun(days: number[]) {
  let best = 0;
  let run = 0;
  for (const [index, day] of days.entries()) {
    run = index > 0 && day === days[index - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export async function clanFacts(clanId: string, now = Date.now()): Promise<ClanFacts | null> {
  const clan = await db.clan.findUnique({
    where: { id: clanId },
    select: { createdAt: true, members: { select: { userId: true } } },
  });
  if (!clan) return null;
  const ids = clan.members.map((member) => member.userId);
  const since = clan.createdAt;
  if (!ids.length) return null;

  const [total, finished, active, nights, insomniacs] = await Promise.all([
    db.userAchievement.count({ where: { userId: { in: ids } } }),
    db.userGame.findMany({
      where: { userId: { in: ids }, completion: { gte: 100 }, hidden: false },
      select: {
        userId: true,
        gameId: true,
        lastUnlockedAt: true,
        game: { select: { tags: true } },
      },
    }),
    // Les jours où chaque membre a débloqué quelque chose, depuis la fondation du clan.
    db.$queryRaw<{ userId: string; day: Date }[]>`
      SELECT DISTINCT ua."userId", ua."unlockedAt"::date AS day
      FROM "UserAchievement" ua
      WHERE ua."userId" = ANY(${ids}) AND ua."unlockedAt" >= ${since}`,
    db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT day)::int AS n FROM (
        SELECT ua."unlockedAt"::date AS day, a."gameId"
        FROM "UserAchievement" ua
        JOIN "Achievement" a ON a.id = ua."achievementId"
        WHERE ua."userId" = ANY(${ids}) AND ua."unlockedAt" >= ${since}
        GROUP BY 1, 2
        HAVING count(DISTINCT ua."userId") >= ${TOGETHER}
      ) evenings`,
    // Entre 2 h et 5 h, à l'heure de chacun.
    db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT (ua."unlockedAt" AT TIME ZONE 'UTC' AT TIME ZONE coalesce(u."timeZone", 'UTC')
          - interval '5 hours')::date AS night
        FROM "UserAchievement" ua
        JOIN "User" u ON u.id = ua."userId"
        WHERE ua."userId" = ANY(${ids}) AND ua."unlockedAt" >= ${since}
          AND extract(hour FROM ua."unlockedAt" AT TIME ZONE 'UTC'
            AT TIME ZONE coalesce(u."timeZone", 'UTC')) BETWEEN 2 AND 4
        GROUP BY 1
        HAVING count(DISTINCT ua."userId") >= ${TOGETHER}
      ) nights`,
  ]);

  const games = new Set(finished.map((row) => row.gameId));
  const players = new Map<string, Set<string>>();
  for (const row of finished) {
    players.set(row.gameId, (players.get(row.gameId) ?? new Set()).add(row.userId));
  }
  const tags = new Set(finished.flatMap((row) => row.game.tags));
  const genres = Object.values(GENRES).filter((genre) =>
    genre.tags.some((tag) => tags.has(tag)),
  ).length;
  const inSeason = finished.filter(
    (row) =>
      row.lastUnlockedAt !== null &&
      row.lastUnlockedAt >= SEASON.startsAt &&
      row.lastUnlockedAt < SEASON.endsAt,
  ).length;

  const days = [...new Set(active.map((row) => dayNumber(row.day)))].toSorted((a, b) => a - b);
  const weeksOf = new Map<string, Set<number>>();
  for (const row of active) {
    weeksOf.set(
      row.userId,
      (weeksOf.get(row.userId) ?? new Set()).add(weekNumber(dayNumber(row.day))),
    );
  }
  const allWeeks =
    ids.length >= TOGETHER
      ? [...(weeksOf.get(ids[0]!) ?? [])].filter((week) =>
          ids.every((id) => weeksOf.get(id)?.has(week)),
        ).length
      : 0;
  const finishers = new Set(finished.map((row) => row.userId));

  return {
    counts: {
      guild: total,
      clan_collection: games.size,
      clan_range: genres,
      raid: Math.max(0, ...[...players.values()].map((set) => set.size)),
      clan_night: nights[0]?.n ?? 0,
      all_in: allWeeks,
      marathon: longestRun(days),
      together_season: inSeason,
      band: ids.length,
    },
    nobodyBehind: ids.length >= TOGETHER && ids.every((id) => finishers.has(id)),
    loyal: ids.length >= TOGETHER && now - since.getTime() >= YEAR,
    insomniacs: (insomniacs[0]?.n ?? 0) > 0,
    // Un mois sans le moindre succès, puis le clan repart.
    ghost: days.some((day, index) => index > 0 && day - days[index - 1]! > GHOST_DAYS),
  };
}

/** Les succès de clan que ces faits méritent. */
export function clanCodes(facts: ClanFacts): ClanCode[] {
  const series = (Object.entries(CLAN_SERIES) as [ClanKey, readonly number[]][]).flatMap(
    ([key, steps]) =>
      steps.filter((step) => facts.counts[key] >= step).map((step) => `${key}_${step}` as ClanCode),
  );
  const singles: [ClanCode, boolean][] = [
    ['nobody_behind', facts.nobodyBehind],
    ['loyal', facts.loyal],
    ['insomniacs', facts.insomniacs],
    ['ghost_clan', facts.ghost],
  ];
  return [...series, ...singles.filter(([, earned]) => earned).map(([code]) => code)];
}

/**
 * Attribue au clan ce qu'il a mérité, et le transmet à ses membres du moment. Un nouveau venu
 * ne reçoit pas ce que le clan avait gagné sans lui : rien ne pousse à changer de clan pour ça.
 */
export async function checkClanAchievements(clanId: string, now = Date.now()) {
  const facts = await clanFacts(clanId, now);
  if (!facts) return [];
  const [owned, members] = await Promise.all([
    db.clanUnlock.findMany({ where: { clanId }, select: { code: true } }),
    db.clanMember.findMany({ where: { clanId }, select: { userId: true } }),
  ]);
  const had = new Set(owned.map((row) => row.code));
  const gained = clanCodes(facts).filter((code) => !had.has(code));
  if (!gained.length) return gained;

  await db.clanUnlock.createMany({
    data: gained.map((code) => ({ clanId, code })),
    skipDuplicates: true,
  });
  await db.siteUnlock.createMany({
    data: members.flatMap(({ userId }) => gained.map((code) => ({ userId, code }))),
    skipDuplicates: true,
  });
  // Les cadres suivent le nombre de succès du clan ; ses membres du moment peuvent les porter.
  const total = had.size + gained.length;
  const frames = CLAN_FRAMES.filter((step) => total >= step.unlocks).map((step) => step.frame);
  await db.clan.update({
    where: { id: clanId },
    data: { frame: clanFrameFor(total) },
    select: { id: true },
  });
  await db.userFrame.createMany({
    data: members.flatMap(({ userId }) => frames.map((frame) => ({ userId, frame }))),
    skipDuplicates: true,
  });
  for (const { userId } of members) {
    publishChat(userId, { type: 'site-achievement', codes: gained });
    // Le premier passage rattrape tout l'historique du clan : il reste muet.
    if (had.size > 0) {
      notify(userId, 'event', `clan-succes:${clanId}`, (locale) => ({
        title: m.clan_ach_push_title({}, { locale }),
        body: m.clan_ach_push_body({ count: gained.length }, { locale }),
        url: '/clan',
      }));
    }
  }
  return gained;
}

/** Le balayage horaire relit chaque clan : un succès peut tomber sans qu'aucun membre se synchronise. */
export async function checkAllClans() {
  const clans = await db.clan.findMany({ select: { id: true } });
  for (const { id } of clans) {
    await checkClanAchievements(id).catch((cause) => log.error('Succès de clan :', cause));
  }
}
