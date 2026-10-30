import { gamesFromUrl } from '$lib/server/game-list';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => gamesFromUrl(url, locals.user);
