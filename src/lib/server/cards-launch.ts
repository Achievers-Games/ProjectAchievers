import { error } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from './auth';

/**
 * L'ouverture des éclats, des boosters et des cartes animées aux membres. Tant qu'elle vaut
 * `null`, tout reste caché et rien ne se gagne :
 * - `/boosters` n'existe que pour la modération, qui prépare les cartes ;
 * - aucune bannière de carte ne s'affiche sur les profils ;
 * - aucun éclat n'est crédité, pas même le capital de départ.
 *
 * Pour ouvrir, mettre la date et l'heure de l'ouverture, puis déployer. Tout le monde part alors
 * de zéro à cette date : l'historique d'avant devient le capital de départ (plafonné), les succès
 * d'après rapportent au barème, et les boosters offerts ne comptent qu'à partir de là.
 */
const CARDS_OPENED_AT: Date | null = null;

/** Les tests parlent du système ouvert ; un test peut le refermer pour vérifier la fermeture. */
let opening: Date | null = CARDS_OPENED_AT ?? (process.env.VITEST ? new Date(0) : null);

export const cardsOpenedAt = () => opening;
export const isCardsOpen = () => opening !== null;

/** Pour les tests seulement : ouvre ou ferme le système. */
export function setCardsOpeningForTests(date: Date | null) {
  opening = date;
}

/**
 * Le début des gains d'un joueur : sa propre date (`User.shardsFrom`, son inscription pour un
 * nouveau venu) mais jamais avant l'ouverture. `null` tant que c'est fermé : rien ne se gagne.
 */
export function shardsStart(shardsFrom: Date): Date | null {
  return opening && (shardsFrom > opening ? shardsFrom : opening);
}

/** Ce compte voit-il les éclats et les boosters ? Toujours pour la modération, qui les prépare. */
export const canSeeCards = (user: App.Locals['user']) =>
  isCardsOpen() || (user !== null && user !== undefined && user.role !== 'USER');

/** Un membre connecté qui peut voir les boosters ; sinon la page n'existe pas. */
export function requireCards(locals: App.Locals, returnTo: string) {
  // Fermé, la page n'existe pas, même pour un visiteur : pas de détour par la connexion.
  if (!canSeeCards(locals.user)) error(404, m.not_found());
  return requireLogin(locals, returnTo);
}
