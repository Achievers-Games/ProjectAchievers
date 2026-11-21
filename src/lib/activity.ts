import type { ActivityEmoji } from '#prisma';

/** Les réactions proposées dans le menu, dans l'ordre d'affichage. */
export const ACTIVITY_EMOJIS = [
  'CLAP',
  'FIRE',
  'HEART',
  'WOW',
  'LAUGH',
  'TROPHY',
  'STRONG',
  'SAD',
] as const satisfies readonly ActivityEmoji[];

export type ActivityReactions = {
  counts: Partial<Record<ActivityEmoji, number>>;
  mine: ActivityEmoji | null;
};

export const unlockHref = (handle: string, id: string) =>
  `/u/${encodeURIComponent(handle)}/succes/${encodeURIComponent(id)}`;
