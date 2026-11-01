import { db } from './db';
import { connectedUsers } from './sync/events';

/** Tous les visiteurs interrogent cette liste : une lecture de la base suffit pour eux tous. */
const MAX_AGE = 15_000;

let cached: { connected: string; handles: string[]; expiresAt: number } | undefined;

/** Un profil privé reste invisible ici aussi, comme un joueur qui a masqué sa présence. */
export async function onlineHandles() {
  const ids = connectedUsers();
  const connected = ids.toSorted().join();
  if (!cached || cached.connected !== connected || cached.expiresAt <= Date.now()) {
    const users = await db.user.findMany({
      where: { id: { in: ids }, isPublic: true, showOnline: true },
      select: { handle: true },
    });
    cached = {
      connected,
      handles: users.map((user) => user.handle),
      expiresAt: Date.now() + MAX_AGE,
    };
  }
  return cached.handles;
}

/** Un joueur qui se masque ne doit pas rester affiché jusqu'à la fin du cache. */
export function forgetPresence() {
  cached = undefined;
}
