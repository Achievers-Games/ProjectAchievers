import { m } from '#lib/paraglide/messages';

/** Du plus simple au plus prestigieux. L'identifiant sert aussi de classe visuelle. */
export const FRAMES = [
  'collector',
  'clan-1',
  'clan-2',
  'clan-3',
  'podium-3',
  'podium-2',
  'podium-1',
] as const;

export type Frame = (typeof FRAMES)[number];

export const isFrame = (value: unknown): value is Frame => FRAMES.includes(value as Frame);

export const COLLECTOR_CARDS = 10;

/** Les cadres de clan, gagnés avec 5, 15 puis 30 succès de clan. */
export const CLAN_FRAMES = [
  { frame: 'clan-1', unlocks: 5 },
  { frame: 'clan-2', unlocks: 15 },
  { frame: 'clan-3', unlocks: 30 },
] as const satisfies readonly { frame: Frame; unlocks: number }[];

/** Le plus beau cadre que tant de succès de clan permettent. */
export const clanFrameFor = (unlocks: number) =>
  CLAN_FRAMES.findLast((step) => unlocks >= step.unlocks)?.frame ?? null;

export function frameLabel(frame: Frame) {
  if (frame === 'collector') return m.frame_collector();
  if (frame === 'clan-1') return m.frame_clan_1();
  if (frame === 'clan-2') return m.frame_clan_2();
  if (frame === 'clan-3') return m.frame_clan_3();
  return m.ranking_place({ place: Number(frame.slice(-1)) });
}

export function frameHint(frame: Frame) {
  const clan = CLAN_FRAMES.find((step) => step.frame === frame);
  if (clan) return m.frame_clan_how({ count: clan.unlocks });
  return frame === 'collector' ? m.frame_collector_how() : m.frame_podium_how();
}
