import type { Game, LinkedAccount } from '#prisma';

export type UnlockedGame = Pick<
  Game,
  'id' | 'name' | 'slug' | 'platform' | 'adultOnly' | 'contentCheckedAt'
>;

export interface SyncContext {
  userId: string;
  account: LinkedAccount;
  /** Une synchronisation explicite relit aussi les jeux sans activité nouvelle. */
  force?: boolean;
  report: (processed: number, total: number, game: string) => void;
  onUnlocked: (game: UnlockedGame, count: number) => void;
}

export type ProviderSync = (
  context: SyncContext,
) => Promise<{ games: number; achievements: number }>;
