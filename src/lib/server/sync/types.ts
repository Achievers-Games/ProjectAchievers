import type { Game, LinkedAccount } from '@prisma/client';

export interface SyncContext {
  userId: string;
  account: LinkedAccount;
  report: (processed: number, total: number, game: string) => void;
  onUnlocked: (game: Pick<Game, 'name' | 'slug' | 'adultOnly'>, count: number) => void;
}

export type ProviderSync = (
  context: SyncContext,
) => Promise<{ games: number; achievements: number }>;
