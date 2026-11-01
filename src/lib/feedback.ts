import type { FeedbackKind, FeedbackStatus } from '@prisma/client';
import { m } from '$lib/paraglide/messages';

export const feedbackKindLabel = (kind: FeedbackKind) =>
  kind === 'BUG' ? m.feedback_bug() : m.feedback_idea();

const STATUS_LABELS: Record<FeedbackStatus, () => string> = {
  NEW: m.feedback_status_new,
  PLANNED: m.feedback_status_planned,
  DONE: m.feedback_status_done,
  DECLINED: m.feedback_status_declined,
};

export const feedbackStatusLabel = (status: FeedbackStatus) => STATUS_LABELS[status]();

export const FEEDBACK_STATUSES = Object.keys(STATUS_LABELS) as FeedbackStatus[];
