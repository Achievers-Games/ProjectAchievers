import { error } from '@sveltejs/kit';
import { logger } from '#lib/logger';
import { eventStream } from '#lib/server/sse';
import {
  onChat,
  onSync,
  type LiveEvent,
  type SyncEvent,
  type UnlockPop,
} from '#lib/server/sync/events';
import { markCelebrated, recentUnlocks } from '#lib/server/sync/store';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

const log = logger('Flux du joueur');

/** Les succès qu'un événement fait fêter à la page. */
function unlocksOf(event: SyncEvent | LiveEvent): UnlockPop[] {
  if ('type' in event) return event.type === 'unlocks' ? event.achievements : [];
  return event.unlocks ?? [];
}

/** Un seul flux par onglet : synchronisations et messages arrivent par le même chemin. */
export const GET: RequestHandler = ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  return eventStream<SyncEvent | LiveEvent>(
    (write) => {
      // Un succès parti vers une page est fêté pour de bon : le compte le retient, et un autre
      // appareil ne le rejouera pas à sa connexion.
      const send = (event: SyncEvent | LiveEvent) => {
        write(event);
        const ids = unlocksOf(event).map((unlock) => unlock.id);
        if (ids.length) {
          markCelebrated(user.id, ids).catch((cause) => log.error('Succès fêtés :', cause));
        }
      };
      const stopSync = onSync(user.id, send);
      const stopChat = onChat(user.id, send);
      // Débloqués pendant que la page était fermée : la page les fête en arrivant.
      void recentUnlocks(user.id)
        .then((achievements) => {
          if (achievements.length) send({ type: 'unlocks', achievements });
        })
        .catch((cause) => log.error('Succès récents :', cause));
      return () => {
        stopSync();
        stopChat();
      };
    },
    request.signal,
    `joueur:${user.id}`,
  );
};
