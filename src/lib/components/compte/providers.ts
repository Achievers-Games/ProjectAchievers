import { m } from '$lib/paraglide/messages';
import type { Provider, SyncStatus } from '@prisma/client';

/** Tous les comptes liables, dans l'ordre d'affichage. */
export const PROVIDERS: Provider[] = [
  'STEAM',
  'PSN',
  'XBOX',
  'RETRO',
  'EPIC',
  'BLIZZARD',
  'DISCORD',
  'GOOGLE',
];

/** Ceux qui passent par une page de consentement ; PSN et Retro ont leur propre formulaire. */
export const OAUTH: Partial<Record<Provider, string>> = {
  STEAM: 'steam',
  DISCORD: 'discord',
  XBOX: 'xbox',
  GOOGLE: 'google',
  EPIC: 'epic',
  BLIZZARD: 'blizzard',
};

/** Discord et Google ne servent qu'à se connecter : ils n'ont rien à synchroniser. */
export const LOGIN_ONLY: Provider[] = ['DISCORD', 'GOOGLE', 'EPIC'];

/** Le réglage de confidentialité ne se montre qu'au compte que la plateforme nous ferme. */
export const PRIVACY: Partial<Record<Provider, { url: string; hint: () => string }>> = {
  STEAM: { url: 'https://steamcommunity.com/my/edit/settings', hint: m.privacy_fix_steam },
  PSN: {
    url: 'https://www.playstation.com/support/account/privacy-settings/',
    hint: m.privacy_fix_psn,
  },
  XBOX: { url: 'https://account.xbox.com/settings', hint: m.privacy_fix_xbox },
};

export const DESCRIPTIONS: Record<Provider, string> = {
  STEAM: m.provider_library(),
  PSN: m.provider_trophies(),
  RETRO: m.provider_retro(),
  XBOX: m.provider_xbox(),
  DISCORD: m.provider_identity(),
  GOOGLE: m.provider_identity(),
  EPIC: m.provider_identity(),
  BLIZZARD: m.provider_blizzard(),
};

export const STATUS: Record<SyncStatus, string> = {
  IDLE: m.status_idle(),
  QUEUED: m.status_queued(),
  SYNCING: m.status_syncing(),
  COMPLETED: m.status_completed(),
  FAILED: m.status_failed(),
  NEEDS_RELINK: m.status_relink(),
};

export const isClosedError = (error: string | null | undefined) =>
  error?.endsWith('_private') ?? false;
