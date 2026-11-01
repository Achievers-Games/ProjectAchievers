import webpush from 'web-push';
import type { PushSubscription as Subscription } from '@prisma/client';
import { db } from './db';
import { env } from './env';
import { rateLimit } from './rate-limit';
import { m } from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';
import { SEASON, seasonState, type Season } from '$lib/season';

export type PushKind = 'message' | 'invite' | 'event' | 'digest';

interface PushContent {
  title: string;
  body: string;
  url: string;
}

/** Un onglet visible interroge la présence toutes les 30 secondes. */
const ACTIVE_WINDOW = 60_000;
/** Une discussion active ne sonne qu'une fois : le reste s'empile dans le même message. */
const CONVERSATION_COOLDOWN = 10 * 60 * 1000;
const MAX_PER_HOUR = 8;
const CLOSING_NOTICE = 3 * 24 * 60 * 60 * 1000;

const PREFERENCES = {
  message: 'pushMessages',
  invite: 'pushInvites',
  event: 'pushEvents',
} as const;

const activeUsers = new Map<string, number>();

export function markActive(userId: string, now = Date.now()) {
  activeUsers.set(userId, now);
  if (activeUsers.size > 10_000) {
    for (const [id, at] of activeUsers) if (now - at > ACTIVE_WINDOW) activeUsers.delete(id);
  }
}

const isActive = (userId: string) => Date.now() - (activeUsers.get(userId) ?? 0) < ACTIVE_WINDOW;

/** Joueurs à qui une notification a été épargnée parce qu'ils regardaient le site. */
const missedWhileActive = new Set<string>();

/** Ceux qui viennent de partir : c'est le moment de leur résumer ce qu'ils n'ont pas vu. */
export function usersWhoLeft() {
  const left = [...missedWhileActive].filter((userId) => !isActive(userId));
  for (const userId of left) missedWhileActive.delete(userId);
  return left;
}

/** Seuls les services de notification des navigateurs reçoivent des requêtes du serveur. */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|windows\.com|apple\.com)$/;

export const isPushEndpoint = (endpoint: string) =>
  endpoint.startsWith('https://') && PUSH_HOSTS.test(new URL(endpoint).hostname);

export const pushPublicKey = () => env().VAPID_PUBLIC_KEY ?? null;

/** Les navigateurs à prévenir, après tous les garde-fous contre le spam. */
export async function subscribersToNotify(userId: string, kind: PushKind, tag: string) {
  if (kind !== 'digest' && kind !== 'event' && isActive(userId)) {
    missedWhileActive.add(userId);
    return [];
  }
  if (isActive(userId)) return [];
  if (kind === 'message' && !rateLimit(`push:${userId}:${tag}`, 1, CONVERSATION_COOLDOWN)) {
    return [];
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { pushMessages: true, pushInvites: true, pushEvents: true, pushSubscriptions: true },
  });
  if (!user?.pushSubscriptions.length) return [];
  if (kind !== 'digest' && !user[PREFERENCES[kind]]) return [];
  if (!rateLimit(`push:${userId}`, MAX_PER_HOUR, 3_600_000)) return [];
  return user.pushSubscriptions;
}

async function deliver(subscription: Subscription, tag: string, content: PushContent) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT } = env();
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_CONTACT) return;
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({ ...content, tag }),
      {
        TTL: 86_400,
        vapidDetails: {
          subject: VAPID_CONTACT,
          publicKey: VAPID_PUBLIC_KEY,
          privateKey: VAPID_PRIVATE_KEY,
        },
      },
    );
  } catch (cause) {
    // 404 ou 410 : le navigateur a retiré cet abonnement.
    const status = (cause as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await db.pushSubscription.deleteMany({ where: { id: subscription.id } });
    } else {
      console.error('Notification :', cause);
    }
  }
}

/** Une notification ne doit jamais retarder ni faire échouer l'action qui la déclenche. */
export function notify(
  userId: string,
  kind: PushKind,
  tag: string,
  content: (locale: Locale) => PushContent,
) {
  void subscribersToNotify(userId, kind, tag)
    .then((subscriptions) =>
      Promise.all(
        subscriptions.map((subscription) =>
          deliver(subscription, tag, content(subscription.locale as Locale)),
        ),
      ),
    )
    .catch((cause) => console.error('Notification :', cause));
}

async function announce(key: string, content: (locale: Locale) => PushContent) {
  const { count } = await db.announcement.createMany({ data: [{ key }], skipDuplicates: true });
  if (count === 0) return;
  const users = await db.user.findMany({
    where: { pushEvents: true, pushSubscriptions: { some: {} } },
    select: { id: true },
  });
  for (const user of users) notify(user.id, 'event', key, content);
}

/** Deux annonces par saison au plus : son ouverture, et ses derniers jours. */
export async function announceSeason(season: Season = SEASON, now = Date.now()) {
  const id = season.startsAt.toISOString().slice(0, 10);
  if (seasonState(season, now) !== 'running') return;
  await announce(`saison:${id}:ouverture`, (locale) => ({
    title: m.banner_season_title({}, { locale }),
    body: m.push_season_open({}, { locale }),
    url: '/saison',
  }));
  if (season.endsAt.getTime() - now > CLOSING_NOTICE) return;
  await announce(`saison:${id}:fin`, (locale) => ({
    title: m.banner_season_title({}, { locale }),
    body: m.push_season_closing({}, { locale }),
    url: '/saison',
  }));
}
