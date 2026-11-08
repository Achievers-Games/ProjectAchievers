import { API_PLATFORMS, KEY_LIMIT, PAGE_LIMIT, PAGE_MAX } from './partner-api';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (type: string, extra = {}) => ({ type: [type, 'null'], ...extra });
const errors = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '404': { $ref: '#/components/responses/NotFound' },
  '429': { $ref: '#/components/responses/RateLimited' },
};
const ok = (schema: object, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const pathParam = (name: string, description: string, schema: object = { type: 'string' }) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema,
});
const handle = pathParam('handle', 'Player handle, as in /u/{handle}.');
const platform = pathParam('platform', 'Platform of the game.', {
  type: 'string',
  enum: Object.keys(API_PLATFORMS),
});
const gameId = pathParam('id', 'Game id on its platform: the Steam appid for Steam (e.g. 683320).');

/** La description OpenAPI 3.1 de `/api/v1`, servie telle quelle aux partenaires. */
export function partnerOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Project Achievers partner API',
      version: '1.0.0',
      description:
        'Read-only access to public Achievers profiles and games. Only public profiles are ' +
        'exposed; games hidden by the player and adult-only games never appear. Secret ' +
        `achievements stay masked until unlocked. Limit: ${KEY_LIMIT} requests per minute per key.`,
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ apiKey: [] }],
    paths: {
      '/users/{handle}': {
        get: {
          summary: 'Public profile and stats',
          parameters: [handle],
          responses: { '200': ok(ref('User'), 'The profile.'), ...errors },
        },
      },
      '/users/{handle}/games': {
        get: {
          summary: 'Games of a player with their progress',
          parameters: [
            handle,
            {
              name: 'platform',
              in: 'query',
              schema: { type: 'string', enum: Object.keys(API_PLATFORMS) },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: PAGE_MAX, default: PAGE_LIMIT },
            },
            {
              name: 'cursor',
              in: 'query',
              description: 'The nextCursor of the previous page.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': ok(
              {
                type: 'object',
                required: ['items', 'nextCursor'],
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { game: ref('Game'), progress: ref('Progress') },
                    },
                  },
                  nextCursor: nullable('string'),
                },
              },
              'One page of games.',
            ),
            ...errors,
          },
        },
      },
      '/users/{handle}/games/{platform}/{id}': {
        get: {
          summary: "A player's progress on one game, achievement by achievement",
          parameters: [handle, platform, gameId],
          responses: {
            '200': ok(
              {
                type: 'object',
                properties: {
                  game: ref('Game'),
                  progress: ref('Progress'),
                  achievements: { type: 'array', items: ref('Achievement') },
                },
              },
              'The game, the progress and every achievement.',
            ),
            ...errors,
          },
        },
      },
      '/games/{platform}/{id}': {
        get: {
          summary: 'A game from its platform id',
          parameters: [platform, gameId],
          responses: {
            '200': ok(
              {
                allOf: [
                  ref('Game'),
                  {
                    type: 'object',
                    properties: {
                      players: { type: 'integer', description: 'Public players owning it.' },
                      completions: { type: 'integer', description: 'Of those, at 100 %.' },
                      completionRate: nullable('number', { description: 'Percent, 0-100.' }),
                    },
                  },
                ],
              },
              'The game.',
            ),
            ...errors,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'Authorization: Bearer ak_… (key given by the Achievers admins).',
        },
      },
      responses: {
        Unauthorized: ok(ref('Error'), 'Missing, unknown or revoked key.'),
        NotFound: ok(ref('Error'), 'Unknown, private or hidden.'),
        RateLimited: ok(ref('Error'), 'Too many requests: wait for Retry-After seconds.'),
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: {
              type: 'string',
              enum: [
                'unauthorized',
                'rate_limited',
                'not_found',
                'bad_request',
                'unknown_platform',
              ],
            },
            message: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            handle: { type: 'string' },
            displayName: { type: 'string' },
            avatarUrl: nullable('string'),
            url: { type: 'string' },
            cardUrl: { type: 'string', description: 'Embeddable SVG player card, 600×180.' },
            memberSince: { type: 'string', format: 'date-time' },
            clan: {
              type: ['object', 'null'],
              properties: {
                name: { type: 'string' },
                slug: { type: 'string' },
                url: { type: 'string' },
              },
            },
            stats: {
              type: 'object',
              properties: {
                games: { type: 'integer' },
                achievements: { type: 'integer' },
                cards: { type: 'integer', description: 'Games finished at 100 %.' },
                cardsByTier: {
                  type: 'array',
                  items: { type: 'integer' },
                  description: 'Cards per tier, from 1 (Bronze) to 6 (Legendary).',
                },
                points: { type: 'integer' },
              },
            },
          },
        },
        Game: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: Object.keys(API_PLATFORMS) },
            platformGameId: { type: 'string', description: 'Steam appid for Steam games.' },
            console: nullable('string', { description: 'PSN only: PS4, PS5…' }),
            slug: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string' },
            coverUrl: nullable('string'),
            headerUrl: nullable('string'),
            totalAchievements: { type: 'integer' },
            tier: nullable('integer', { description: 'Difficulty, 1 (Bronze) to 6 (Legendary).' }),
          },
        },
        Progress: {
          type: 'object',
          properties: {
            unlocked: { type: 'integer' },
            total: { type: 'integer' },
            completion: { type: 'number', description: 'Percent, 0-100.' },
            completed: { type: 'boolean' },
            platinum: { type: 'boolean' },
            lastUnlockedAt: nullable('string', { format: 'date-time' }),
          },
        },
        Achievement: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Achievement id on its platform.' },
            name: nullable('string', { description: 'Null while a secret one is locked.' }),
            description: nullable('string'),
            iconUrl: nullable('string'),
            hidden: { type: 'boolean' },
            trophyType: {
              type: 'string',
              enum: ['platinum', 'gold', 'silver', 'bronze', 'achievement'],
            },
            rarity: nullable('number', { description: 'Percent of players who have it.' }),
            unlocked: { type: 'boolean' },
            unlockedAt: nullable('string', { format: 'date-time' }),
          },
        },
      },
    },
  };
}
