import { collectors } from '#lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ ranking: await collectors(100) });
