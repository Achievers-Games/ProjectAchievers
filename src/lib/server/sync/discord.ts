import { applyAccountLook } from '../accounts';
import { db } from '../db';
import { env } from '../env';
import { discordLook, type DiscordUser } from '../providers/discord';
import { sleep } from './errors';

const STALE_AFTER = 24 * 60 * 60 * 1000;
const BATCH = 100;
const PAUSE = 1_000;

/** Relit l'apparence des comptes Discord : le bot évite de garder un jeton par joueur. */
export async function refreshDiscordAccounts(pause = PAUSE) {
  const token = env().DISCORD_BOT_TOKEN;
  if (!token) return 0;

  const accounts = await db.linkedAccount.findMany({
    where: {
      provider: 'DISCORD',
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - STALE_AFTER) } }],
    },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: BATCH,
  });

  let refreshed = 0;
  for (const account of accounts) {
    const response = await fetch(`https://discord.com/api/v10/users/${account.providerUserId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    // Limite atteinte : le prochain passage reprendra les comptes restants.
    if (response.status === 429) break;

    if (response.ok) {
      const { avatarUrl, ...look } = discordLook((await response.json()) as DiscordUser);
      await applyAccountLook(account, look, avatarUrl);
      await db.linkedAccount.update({
        where: { id: account.id },
        data: { lastSyncedAt: new Date() },
      });
      refreshed += 1;
    }
    await sleep(pause);
  }
  return refreshed;
}
