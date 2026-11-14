import { db } from '../db';
import { fetchPlayingGames } from '../providers/steam';
import { publicGames } from '../queries/shared';
import { getBasicPresence } from 'psn-api';
import { psnAuthorization } from '../providers/psn';
import { availableProviders } from '../providers';
import { mapLimit } from './errors';
import { retroGet } from '../providers/retro';

type Game = { name: string; slug: string; platform?: 'PSN' | 'RETRO' };
const RETRO_SIGNAL_MAX_AGE = 5 * 60_000;
const retroCache = new WeakMap<
  object,
  { accountId: string; until: number; gameId?: string; expiresAt?: number }
>();
type Listener = (game: Game | null) => void;
const watched = new Map<string, { listeners: Set<Listener>; game?: Game | null }>();
let timer: ReturnType<typeof setInterval> | undefined;
let checking = false;

async function refresh() {
  if (checking) return;
  checking = true;
  const snapshot = [...watched];
  const entries = new Map(snapshot);
  const providers = availableProviders();
  try {
    const accounts = await db.linkedAccount.findMany({
      where: {
        provider: {
          in: (['STEAM', 'PSN', 'RETRO'] as const).filter((provider) => providers[provider]),
        },
        user: {
          handle: { in: snapshot.map(([handle]) => handle) },
          isPublic: true,
          showOnline: true,
        },
      },
      select: {
        provider: true,
        userId: true,
        providerUserId: true,
        user: { select: { handle: true } },
      },
    });
    const steam = accounts.filter((account) => account.provider === 'STEAM');
    const current = new Map(steam.map((account) => [account.user.handle, account]));
    // Même appel que le suivi en direct : un joueur suivi des deux côtés ne coûte qu'une fois.
    const playing = steam.length
      ? ((await fetchPlayingGames(steam.map((account) => account.providerUserId)).catch(
          () => null,
        )) ?? new Map<string, string>())
      : new Map<string, string>();
    const games = await db.game.findMany({
      where: {
        ...publicGames,
        platform: 'STEAM',
        platformGameId: { in: [...new Set(playing.values())] },
      },
      select: {
        platformGameId: true,
        name: true,
        slug: true,
        players: {
          where: { hidden: true, userId: { in: accounts.map((account) => account.userId) } },
          select: { userId: true },
        },
      },
    });
    const byApp = new Map(games.map((game) => [game.platformGameId, game]));
    const psnGames = new Map<string, Game>();
    await mapLimit(
      accounts.filter((account) => account.provider === 'PSN'),
      2,
      async (account) => {
        try {
          const { basicPresence } = await getBasicPresence(
            await psnAuthorization(),
            account.providerUserId,
          );
          if (
            (basicPresence?.primaryPlatformInfo?.onlineStatus ?? basicPresence?.onlineStatus) !==
            'online'
          )
            return;
          const title = basicPresence.gameTitleInfoList?.[0];
          if (!title?.titleName || !['PS4', 'PS5'].includes(title.format?.toUpperCase())) return;
          const matches = await db.userGame.findMany({
            where: {
              userId: account.userId,
              game: {
                platform: 'PSN',
                name: { equals: title.titleName, mode: 'insensitive' },
                console: { contains: title.format.toUpperCase() },
              },
            },
            select: { hidden: true, game: { select: { name: true, slug: true, adultOnly: true } } },
            take: 2,
          });
          const [match] = matches;
          if (matches.length === 1 && match && !match.hidden && !match.game.adultOnly) {
            psnGames.set(account.user.handle, {
              name: match.game.name,
              slug: match.game.slug,
              platform: 'PSN',
            });
          }
        } catch {
          // Un statut PSN indisponible n'interrompt pas la présence Steam.
        }
      },
    );
    const retroGames = new Map<string, Game>();
    await mapLimit(
      accounts.filter((account) => account.provider === 'RETRO'),
      2,
      async (account) => {
        const handle = account.user.handle;
        const entry = entries.get(handle);
        if (!entry) return;
        try {
          let cached = retroCache.get(entry);
          if (
            !cached ||
            cached.accountId !== account.providerUserId ||
            cached.until <= Date.now()
          ) {
            cached = { accountId: account.providerUserId, until: Date.now() + 60_000 };
            retroCache.set(entry, cached);
            const response = await retroGet('API_GetUserRecentlyPlayedGames.php', {
              u: account.providerUserId,
              c: 1,
            });
            if (!response.ok) return;
            const games = (await response.json()) as { GameID: number; LastPlayed: string }[];
            const game = games[0];
            const playedAt = Date.parse(
              game?.LastPlayed?.replace(' ', 'T').replace(/(?<=\d)$/u, 'Z') ?? '',
            );
            if (
              !game ||
              !Number.isFinite(playedAt) ||
              playedAt > Date.now() ||
              Date.now() - playedAt >= RETRO_SIGNAL_MAX_AGE
            )
              return;
            cached.gameId = String(game.GameID);
            cached.expiresAt = playedAt + RETRO_SIGNAL_MAX_AGE;
          }
          if (!cached.gameId || !cached.expiresAt || cached.expiresAt <= Date.now()) return;
          const row = await db.userGame.findFirst({
            where: {
              userId: account.userId,
              hidden: false,
              game: { ...publicGames, platform: 'RETRO', platformGameId: cached.gameId },
            },
            select: { game: { select: { name: true, slug: true } } },
          });
          if (row) retroGames.set(handle, { ...row.game, platform: 'RETRO' });
        } catch {
          // L'activité récente n'est pas toujours disponible.
        }
      },
    );
    for (const [handle, entry] of snapshot) {
      if (watched.get(handle) !== entry) continue;
      const account = current.get(handle);
      const game = account && byApp.get(playing.get(account.providerUserId) ?? '');
      const next =
        game && !game.players.some((player) => player.userId === account?.userId)
          ? { name: game.name, slug: game.slug }
          : (psnGames.get(handle) ?? retroGames.get(handle) ?? null);
      if (
        entry.game?.slug === next?.slug &&
        entry.game?.name === next?.name &&
        entry.game?.platform === next?.platform
      )
        continue;
      entry.game = next;
      for (const listener of entry.listeners) listener(next);
    }
  } catch {
    for (const [handle, entry] of snapshot) {
      if (watched.get(handle) !== entry || !entry.game) continue;
      entry.game = null;
      for (const listener of entry.listeners) listener(null);
    }
  } finally {
    checking = false;
  }
}

export function watchSteamPresence(handle: string, send: Listener) {
  let entry = watched.get(handle);
  if (!entry) {
    entry = { listeners: new Set() };
    watched.set(handle, entry);
  }
  entry.listeners.add(send);
  send(entry.game ?? null);
  if (!timer) {
    // Au rythme du suivi en direct, pour partager ses réponses de Steam.
    timer = setInterval(() => void refresh(), 10_000);
    timer.unref();
    void refresh();
  }
  return () => {
    entry.listeners.delete(send);
    if (!entry.listeners.size) watched.delete(handle);
    if (!watched.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
