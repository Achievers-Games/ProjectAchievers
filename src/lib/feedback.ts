import type { FeedbackArea, FeedbackKind, FeedbackStatus } from '@prisma/client';
import { m } from '$lib/paraglide/messages';

export const feedbackKindLabel = (kind: FeedbackKind) =>
  kind === 'BUG' ? m.feedback_bug() : m.feedback_idea();

const AREA_LABELS: Record<FeedbackArea, () => string> = {
  ACCOUNT: m.feedback_area_account,
  SYNC: m.feedback_area_sync,
  GAMES: m.feedback_area_games,
  ACHIEVEMENTS: m.feedback_area_achievements,
  COMMUNITY: m.feedback_area_community,
  SEASON: m.feedback_area_season,
  NOTIFICATIONS: m.feedback_area_notifications,
  OTHER: m.feedback_area_other,
};

export const feedbackAreaLabel = (area: FeedbackArea) => AREA_LABELS[area]();

export const FEEDBACK_AREAS = Object.keys(AREA_LABELS) as FeedbackArea[];

const STATUS_LABELS: Record<FeedbackStatus, () => string> = {
  NEW: m.feedback_status_new,
  PLANNED: m.feedback_status_planned,
  DONE: m.feedback_status_done,
  DECLINED: m.feedback_status_declined,
};

export const feedbackStatusLabel = (status: FeedbackStatus) => STATUS_LABELS[status]();

export const FEEDBACK_STATUSES = Object.keys(STATUS_LABELS) as FeedbackStatus[];
