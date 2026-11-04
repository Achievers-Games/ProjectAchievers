import { requireLogin } from '#lib/server/auth';
import { listConversations } from '#lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
  conversations: await listConversations(requireLogin(locals, '/messages').id),
});
