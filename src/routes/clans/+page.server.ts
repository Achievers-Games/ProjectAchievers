import { listClans } from '$lib/server/social';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ clans: await listClans() });
