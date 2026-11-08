import { Prisma, type Provider } from '#prisma';
import { logger } from '#lib/logger';
import { db } from './db';
import { env } from './env';

const log = logger('Partenaire');

/** Le partenaire relié aujourd'hui ; la table en accepte d'autres. */
export const LURE = 'lure';

/** L'identité d'un fournisseur, telle que les deux sites peuvent la comparer. */
export interface ProviderIdentity {
  provider: Provider;
  providerUserId: string;
}

/** Court exprès : une panne de Lure ne doit jamais retarder une connexion. */
const LOOKUP_TIMEOUT = 2_000;

/** Vrai quand les deux réglages du partenaire sont là : sinon, aucun appel ne sort. */
export const lureConfigured = () => Boolean(env().LURE_API_URL && env().LURE_API_KEY);

/** Les identités vérifiées du compte : celles qui peuvent exister des deux côtés. */
export const providerIdentities = (userId: string): Promise<ProviderIdentity[]> =>
  db.linkedAccount.findMany({
    where: { userId },
    select: { provider: true, providerUserId: true },
  });

/**
 * Les comptes Achievers qui ont vérifié ces identités auprès du fournisseur.
 *
 * Le partenaire ne les obtient pas d'ici : il n'envoie que des identifiants qu'il a lui-même
 * vérifiés, et ne reçoit que des identifiants de comptes, sans nom ni donnée de profil.
 */
export async function findUsersByIdentities(identities: ProviderIdentity[]): Promise<string[]> {
  if (identities.length === 0) return [];
  const rows = await db.linkedAccount.findMany({
    where: { OR: identities },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.map((row) => row.userId);
}

/**
 * Demande à Lure quels de ses comptes portent ces identités.
 *
 * Une panne, une lenteur ou une réponse inattendue rendent une liste vide : la connexion
 * continue, simplement sans liaison.
 */
export async function lookupAtLure(identities: ProviderIdentity[]): Promise<string[]> {
  const { LURE_API_URL, LURE_API_KEY } = env();
  if (!LURE_API_URL || !LURE_API_KEY || identities.length === 0) return [];

  try {
    const response = await fetch(
      `${LURE_API_URL.replace(/\/+$/, '')}/api/v1/partner/identities/lookup`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LURE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identities }),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
      },
    );
    if (!response.ok) {
      log.warn(`recherche d'identités Lure : ${response.status}`);
      return [];
    }
    const data = (await response.json()) as { partnerUserIds?: unknown };
    return Array.isArray(data.partnerUserIds)
      ? data.partnerUserIds.filter((id): id is string => typeof id === 'string' && id !== '')
      : [];
  } catch (cause) {
    log.warn("recherche d'identités Lure :", cause);
    return [];
  }
}

const unique = (values: string[]) => [...new Set(values)];

/**
 * Relie le compte à son homologue chez Lure quand une identité OAuth commune le prouve.
 *
 * Le fournisseur a authentifié la même personne des deux côtés : aucun site ne croit l'autre
 * sur parole. Plusieurs comptes Lure correspondent ? Aucun lien automatique : c'est au joueur
 * de choisir, comme pour une fusion. Vrai quand le lien existe à la fin.
 */
export async function autoLinkLure(
  userId: string,
  lookup: (identities: ProviderIdentity[]) => Promise<string[]> = lookupAtLure,
): Promise<boolean> {
  const existing = await db.partnerLink.findUnique({
    where: { userId_partner: { userId, partner: LURE } },
    select: { revokedAt: true },
  });
  // Délié par le joueur : son choix tient, même si les identités correspondent toujours.
  if (existing) return existing.revokedAt === null;

  const identities = await providerIdentities(userId);
  if (identities.length === 0) return false;

  const partnerUserIds = unique(await lookup(identities));
  if (partnerUserIds.length === 0) return false;
  if (partnerUserIds.length > 1) {
    log.info(`liaison Lure ambiguë pour ${userId} : ${partnerUserIds.length} comptes`);
    return false;
  }

  const partnerUserId = partnerUserIds[0];
  const owner = await db.partnerLink.findUnique({
    where: { partner_partnerUserId: { partner: LURE, partnerUserId } },
    select: { userId: true, revokedAt: true },
  });
  if (owner) return owner.userId === userId && owner.revokedAt === null;

  try {
    await db.partnerLink.create({
      data: { userId, partner: LURE, partnerUserId, method: 'AUTO' },
    });
    return true;
  } catch (cause) {
    // Deux connexions à la fois : l'autre a écrit la ligne. Le compte Lure, lui, reste unique.
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
      const linked = await db.partnerLink.findUnique({
        where: { userId_partner: { userId, partner: LURE } },
        select: { id: true },
      });
      return Boolean(linked);
    }
    throw cause;
  }
}

/**
 * Délier ne touche qu'ici : le partenaire l'apprend à son prochain appel. La ligne reste,
 * datée : sans elle, la connexion suivante relierait aussitôt les mêmes identités.
 */
export const unlinkPartner = (userId: string, partner: string) =>
  db.partnerLink.updateMany({
    where: { userId, partner, revokedAt: null },
    data: { revokedAt: new Date() },
  });

/** Les comptes partenaires reliés, sans ceux que le joueur a déliés. */
export const activePartnerLinks = (userId: string) =>
  db.partnerLink.findMany({
    where: { userId, revokedAt: null },
    select: { partner: true, method: true, createdAt: true },
  });
