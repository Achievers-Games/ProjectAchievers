import { logger } from '#lib/logger';
import { currentKeyPrefix, decrypt, encrypt } from './crypto';
import { db } from './db';

const log = logger('Chiffrement');
const BATCH = 200;

/** Rechiffre une valeur avec la clé en service ; `null` si elle est illisible, donc laissée telle quelle. */
function rewrap(sealed: string | null) {
  if (sealed === null) return undefined;
  try {
    return encrypt(decrypt(sealed));
  } catch (cause) {
    log.error('Secret illisible avec les clés connues :', cause);
    return null;
  }
}

/**
 * Remet sous la clé en service tout ce qui est encore chiffré avec une ancienne clé, ou à
 * l'ancien format : jetons Xbox des joueurs, secrets de webhook des partenaires et NPSSO du
 * compte de service PSN. Tant que ce
 * compte ne tombe pas à zéro, l'ancienne clé doit rester dans `ENCRYPTION_KEY_PREVIOUS`.
 * Renvoie le nombre de lignes encore à traiter après ce passage.
 */
export async function rewrapSecrets() {
  const current = { startsWith: currentKeyPrefix() };
  const staleAccounts = {
    OR: [
      { accessTokenEnc: { not: null }, NOT: { accessTokenEnc: current } },
      { refreshTokenEnc: { not: null }, NOT: { refreshTokenEnc: current } },
    ],
  };
  const staleApps = { webhookSecret: { not: null }, NOT: { webhookSecret: current } };

  const accounts = await db.linkedAccount.findMany({
    where: staleAccounts,
    select: { id: true, accessTokenEnc: true, refreshTokenEnc: true },
    take: BATCH,
  });
  let done = 0;
  for (const account of accounts) {
    const accessTokenEnc = rewrap(account.accessTokenEnc);
    const refreshTokenEnc = rewrap(account.refreshTokenEnc);
    if (accessTokenEnc === null || refreshTokenEnc === null) continue;
    // Une synchronisation a pu renouveler ces jetons entre-temps : seule la valeur lue est remplacée.
    const { count } = await db.linkedAccount.updateMany({
      where: {
        id: account.id,
        accessTokenEnc: account.accessTokenEnc,
        refreshTokenEnc: account.refreshTokenEnc,
      },
      data: { accessTokenEnc, refreshTokenEnc },
    });
    done += count;
  }

  const apps = await db.partnerApp.findMany({
    where: staleApps,
    select: { id: true, webhookSecret: true },
    take: BATCH,
  });
  for (const app of apps) {
    const webhookSecret = rewrap(app.webhookSecret);
    if (!webhookSecret) continue;
    const { count } = await db.partnerApp.updateMany({
      where: { id: app.id, webhookSecret: app.webhookSecret },
      data: { webhookSecret },
    });
    done += count;
  }

  const staleTokens = { valueEnc: { not: null }, NOT: { valueEnc: current } };
  const tokens = await db.serviceToken.findMany({
    where: staleTokens,
    select: { name: true, valueEnc: true },
  });
  for (const token of tokens) {
    const valueEnc = rewrap(token.valueEnc);
    if (!valueEnc) continue;
    const { count } = await db.serviceToken.updateMany({
      where: { name: token.name, valueEnc: token.valueEnc },
      data: { valueEnc },
    });
    done += count;
  }

  const [accountsLeft, appsLeft, tokensLeft] = await Promise.all([
    db.linkedAccount.count({ where: staleAccounts }),
    db.partnerApp.count({ where: staleApps }),
    db.serviceToken.count({ where: staleTokens }),
  ]);
  const left = accountsLeft + appsLeft + tokensLeft;
  if (done || left) log.info(`${done} secrets rechiffrés, ${left} encore sous une ancienne clé`);
  return left;
}
