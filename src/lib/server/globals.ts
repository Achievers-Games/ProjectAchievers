import type { PrismaClient } from '@prisma/client';
import type { EventEmitter } from 'node:events';
import type { PgBoss } from 'pg-boss';

/** Les services de longue vie du serveur, repris tels quels si le module est rechargé. */
interface ServerGlobals {
  prisma?: PrismaClient;
  paBoss?: Promise<PgBoss>;
  paEvents?: EventEmitter;
  paDigest?: NodeJS.Timeout;
  paLive?: NodeJS.Timeout;
}

declare global {
  var __paServer: ServerGlobals | undefined;
}

export const globals: ServerGlobals = (globalThis.__paServer ??= {});
