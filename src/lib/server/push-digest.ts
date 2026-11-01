import { db } from './db';
import { notify, usersWhoLeft } from './push';
import { pendingInvites, unreadCount } from './social';
import { m } from '$lib/paraglide/messages';

const INTERVAL = 30_000;

/** Comme sur Discord : rien tant que le joueur est là, un seul résumé quand il s'en va. */
export async function sendDigests() {
  for (const userId of usersWhoLeft()) {
    const [user, unread, invites] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { pushMessages: true, pushInvites: true },
      }),
      unreadCount(userId),
      pendingInvites(userId),
    ]);
    // Ce qu'il a déjà lu ou traité avant de partir ne compte plus.
    const count =
      (user?.pushMessages ? unread : 0) + (user?.pushInvites ? invites.friends + invites.clans : 0);
    if (!count) continue;
    notify(userId, 'digest', 'resume', (locale) => ({
      title: 'Achievers',
      body: m.push_digest({ count }, { locale }),
      url: '/communaute',
    }));
  }
}

const globalForDigest = globalThis as unknown as { paDigest?: NodeJS.Timeout };

export function startDigests() {
  globalForDigest.paDigest ??= setInterval(() => {
    sendDigests().catch((cause) => console.error('Résumé :', cause));
  }, INTERVAL);
  globalForDigest.paDigest.unref();
}
