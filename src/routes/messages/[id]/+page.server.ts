import { error } from '@sveltejs/kit';
import { requireLogin } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { listConversations } from '$lib/server/social';
import { m } from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const user = requireLogin(locals, `/messages/${params.id}`);
  const member = await db.conversationMember.count({
    where: { conversationId: params.id, userId: user.id },
  });
  if (!member) error(404, m.gone());
  const conversations = await listConversations(user.id);
  return {
    id: params.id,
    title: conversations.find((row) => row.id === params.id)?.title ?? '',
  };
};
