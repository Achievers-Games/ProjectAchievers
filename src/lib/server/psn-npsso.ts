import { env } from './env';

/**
 * Le NPSSO du compte de service PSN : celui qu'un administrateur a saisi sur le site, sinon la
 * variable d'environnement. Gardé en mémoire, sans dépendance : `availableProviders` le lit à
 * chaque requête. `service-token.ts` le charge au démarrage et le remplace à chaque saisie.
 */
let saved: string | undefined;

export const psnNpsso = () => saved ?? env().PSN_SERVICE_NPSSO ?? '';

export function setSavedNpsso(value: string | undefined) {
  saved = value || undefined;
}
