import { describe, expect, it } from 'vitest';
import { partnerOpenApi } from './partner-openapi';

describe('description OpenAPI', () => {
  const spec = partnerOpenApi('https://achievers.test');
  const paths = spec.paths as unknown as Record<string, Record<string, Record<string, unknown>>>;

  it('décrit les routes /me avec la portée OAuth qu’elles exigent', () => {
    expect(paths['/me']?.get).toMatchObject({
      operationId: 'getMe',
      security: [{ oauth2: ['profile'] }],
      parameters: [],
    });
    expect(paths['/me/games/{platform}/{id}']?.get).toMatchObject({
      security: [{ oauth2: ['achievements'] }],
    });
    const params = paths['/me/games']?.get?.parameters as { name: string }[];
    expect(params.map((p) => p.name)).not.toContain('handle');
    expect(params.map((p) => p.name)).toContain('cursor');
  });

  it('garde des identifiants d’opération uniques', () => {
    const ids = Object.values(paths).flatMap((route) =>
      Object.values(route).map((operation) => operation.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
