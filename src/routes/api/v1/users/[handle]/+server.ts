import { apiJson, notFound, partnerRoute } from '#lib/server/partner-api';
import { partnerUser } from '#lib/server/partner-queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = partnerRoute(async ({ params }) => {
  const user = await partnerUser(params.handle);
  return user ? apiJson(user) : notFound('Public profile');
});
