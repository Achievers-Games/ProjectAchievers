import type { Cookies } from '@sveltejs/kit';
import { secureCookie } from './cookies';
import { db } from './db';
import { randomToken, sha256 } from './crypto';

const SESSION_COOKIE = 'pa_session';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD = 15 * DAY;
const TOUCH_INTERVAL = 60 * 60 * 1000;

export type SessionUser = NonNullable<Awaited<ReturnType<typeof validateSession>>>;

function setCookie(cookies: Cookies, token: string, expires: Date) {
  cookies.set(SESSION_COOKIE, token, {
    ...secureCookie,
    path: '/',
    expires,
  });
}

export async function createSession(cookies: Cookies, userId: string, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db.session.create({
    data: { id: sha256(token), userId, expiresAt, userAgent: userAgent?.slice(0, 255) },
  });
  setCookie(cookies, token, expiresAt);
}

export async function validateSession(cookies: Cookies) {
  const token = cookies.get(SESSION_COOKIE);
  if (!token) return null;

  const id = sha256(token);
  const session = await db.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          handle: true,
          displayName: true,
          avatarUrl: true,
          avatarMotionUrl: true,
          frame: true,
          frameMotionUrl: true,
          role: true,
          showAdult: true,
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await db.session.delete({ where: { id } }).catch(() => {});
    cookies.delete(SESSION_COOKIE, { path: '/' });
    return null;
  }

  // Session glissante : prolongée quand il reste moins de 15 jours.
  if (session.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
    await db.session.update({ where: { id }, data: { expiresAt, lastUsedAt: new Date() } });
    setCookie(cookies, token, expiresAt);
  } else if (Date.now() - session.lastUsedAt.getTime() > TOUCH_INTERVAL) {
    await db.session.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }

  return { ...session.user, sessionId: id };
}

export async function destroySession(cookies: Cookies) {
  const token = cookies.get(SESSION_COOKIE);
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
