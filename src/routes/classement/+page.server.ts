import { publicCollectors } from '#lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
  depends('app:sync');
  return { ranking: await publicCollectors(100) };
};
