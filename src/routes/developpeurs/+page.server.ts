import { partnerGuide } from '#lib/server/partner-guide';
import type { PageServerLoad } from './$types';

/** Le guide de l'API partenaires, public : la documentation à envoyer en un seul lien. */
export const load: PageServerLoad = () => partnerGuide();
