import { m } from '$lib/paraglide/messages';

/** Du plus simple au plus prestigieux. L'identifiant sert aussi de classe visuelle. */
export const FRAMES = ['collector', 'podium-3', 'podium-2', 'podium-1'] as const;

export type Frame = (typeof FRAMES)[number];

export const isFrame = (value: unknown): value is Frame => FRAMES.includes(value as Frame);

export const COLLECTOR_CARDS = 10;

export function frameLabel(frame: Frame) {
  if (frame === 'collector') return m.frame_collector();
  return m.ranking_place({ place: Number(frame.slice(-1)) });
}

export const frameHint = (frame: Frame) =>
  frame === 'collector' ? m.frame_collector_how() : m.frame_podium_how();
