import type { Identity } from '../accounts';
import { blizzardAuthorizeUrl, exchangeBlizzardCode } from './blizzard';
import { discordAuthorizeUrl, exchangeDiscordCode } from './discord';
import { epicAuthorizeUrl, exchangeEpicCode } from './epic';
import { exchangeGoogleCode, googleAuthorizeUrl } from './google';
import type { OAuthProvider } from './index';
import { exchangeXboxCode, xboxAuthorizeUrl } from './xbox';

/** Un fournisseur à code d'autorisation : où envoyer le joueur, et comment lire son retour. */
interface CodeFlow {
  authorizeUrl: (state: string, verifier: string) => string;
  exchange: (code: string, verifier: string) => Promise<Identity>;
}

/**
 * Tous les fournisseurs sauf Steam, qui parle OpenID et n'a pas de code à échanger. Ajouter un
 * fournisseur, c'est ajouter une ligne ici : le départ et le retour la lisent tous les deux.
 * Epic et Blizzard n'emploient pas PKCE et ignorent le vérificateur.
 */
export const CODE_FLOWS: Record<Exclude<OAuthProvider, 'steam'>, CodeFlow> = {
  discord: { authorizeUrl: discordAuthorizeUrl, exchange: exchangeDiscordCode },
  google: { authorizeUrl: googleAuthorizeUrl, exchange: exchangeGoogleCode },
  xbox: { authorizeUrl: xboxAuthorizeUrl, exchange: exchangeXboxCode },
  epic: { authorizeUrl: epicAuthorizeUrl, exchange: exchangeEpicCode },
  blizzard: { authorizeUrl: blizzardAuthorizeUrl, exchange: exchangeBlizzardCode },
};
