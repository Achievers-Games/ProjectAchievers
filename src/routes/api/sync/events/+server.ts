import { error } from '@sveltejs/kit';
import { logger } from '#lib/logger';
import { eventStream } from '#lib/server/sse';
import { onChat, onSync, type LiveEvent, type SyncEvent } from '#lib/server/sync/events';
import { recentUnlocks } from '#lib/server/sync/store';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

const log = logger('Flux du joueur');

/** Un seul flux par onglet : synchronisations et messages arrivent par le même chemin. */
export const GET: RequestHandler = ({ locals, request }) => {
  const user = locals.user;
  if (!user) error(401, m.login_required());
  return eventStream<SyncEvent | LiveEvent>((send) => {
    const stopSync = onSync(user.id, send);
    const stopChat = onChat(user.id, send);
    // Débloqués pendant que la page était fermée : la page les fête en arrivant. Elle garde
    // mémoire de ceux qu'elle a déjà montrés, donc une visite suivante ne les rejoue pas.
    void recentUnlocks(user.id)
      .then((achievements) => {
        if (achievements.length) send({ type: 'unlocks', achievements });
      })
      .catch((cause) => log.error('Succès récents :', cause));
    return () => {
      stopSync();
      stopChat();
    };
  }, request.signal);
};
