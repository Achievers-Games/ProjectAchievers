import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { connectedUsers } from '$lib/server/sync/events';
import type { RequestHandler } from './$types';

/** Tous les visiteurs interrogent cette liste : une lecture de la base suffit pour eux tous. */
const MAX_AGE = 15_000;

let cached: { connected: string; handles: string[]; expiresAt: number } | undefined;

/** Seuls les profils publics apparaissent : un profil privé reste invisible, ici aussi. */
export const GET: RequestHandler = async () => {
  const ids = connectedUsers();
  const connected = ids.toSorted().join();
  if (!cached || cached.connected !== connected || cached.expiresAt <= Date.now()) {
    const users = await db.user.findMany({
      where: { id: { in: ids }, isPublic: true },
      select: { handle: true },
    });
    cached = {
      connected,
      handles: users.map((user) => user.handle),
      expiresAt: Date.now() + MAX_AGE,
    };
  }
  return json(cached.handles);
};
