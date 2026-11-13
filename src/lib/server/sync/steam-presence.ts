import { db } from '../db';
import { fetchPlayingGames } from '../providers/steam';
import { publicGames } from '../queries/shared';

type Game = { name: string; slug: string };
type Listener = (game: Game | null) => void;
const watched = new Map<string, { listeners: Set<Listener>; game?: Game | null }>();
let timer: ReturnType<typeof setInterval> | undefined;
let checking = false;

async function refresh() {
  if (checking) return;
  checking = true;
  const snapshot = [...watched];
  try {
    const accounts = await db.linkedAccount.findMany({
      where: {
        provider: 'STEAM',
        user: {
          handle: { in: snapshot.map(([handle]) => handle) },
          isPublic: true,
          showOnline: true,
        },
      },
      select: { userId: true, providerUserId: true, user: { select: { handle: true } } },
    });
    const current = new Map(accounts.map((account) => [account.user.handle, account]));
    const playing = new Map<string, string>();
    for (let i = 0; i < accounts.length; i += 100) {
      const ids = accounts.slice(i, i + 100).map((account) => account.providerUserId);
      const games = await fetchPlayingGames(ids).catch(() => null);
      for (const [id, app] of games ?? []) playing.set(id, app);
    }
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
    for (const [handle, entry] of snapshot) {
      if (watched.get(handle) !== entry) continue;
      const account = current.get(handle);
      const game = account && byApp.get(playing.get(account.providerUserId) ?? '');
      const next =
        game && !game.players.some((player) => player.userId === account?.userId)
          ? { name: game.name, slug: game.slug }
          : null;
      if (entry.game?.slug === next?.slug && entry.game?.name === next?.name) continue;
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
    timer = setInterval(() => void refresh(), 5_000);
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
