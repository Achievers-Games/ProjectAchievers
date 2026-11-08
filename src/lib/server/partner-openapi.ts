import {
  API_PLATFORMS,
  API_SORT_KEYS,
  API_STATUS_KEYS,
  KEY_LIMIT,
  PAGE_LIMIT,
  PAGE_MAX,
} from './partner-api';

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
          operationId: 'getUser',
          summary: 'Public profile and stats',
          parameters: [handle],
          responses: { '200': ok(ref('User'), 'The profile.'), ...errors },
        },
      },
      '/users/{handle}/games': {
        get: {
          operationId: 'listUserGames',
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
              description: `Values above ${PAGE_MAX} are capped at ${PAGE_MAX}.`,
              schema: { type: 'integer', minimum: 1, maximum: PAGE_MAX, default: PAGE_LIMIT },
            },
            {
              name: 'sort',
              in: 'query',
              description:
                'Order of the games. Omitted: a stable historical order with no meaning for ' +
                'the partner; ask for an order before reading more than one page.',
              schema: { type: 'string', enum: API_SORT_KEYS },
            },
            {
              name: 'status',
              in: 'query',
              description: 'completed: 100 %; started: above 0 % and below 100 %; untouched: 0 %.',
              schema: { type: 'string', enum: API_STATUS_KEYS },
            },
            {
              name: 'since',
              in: 'query',
              description:
                'Only progress Achievers wrote at or after this instant: the way to catch up ' +
                'incrementally with what changed since the last call.',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'cursor',
              in: 'query',
              description: 'The nextCursor of the previous page, read with the same sort.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '400': { $ref: '#/components/responses/BadRequest' },
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
          operationId: 'getUserGame',
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
          operationId: 'getGame',
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
        BadRequest: ok(
          ref('Error'),
          'A query parameter is invalid, or the cursor suits another sort.',
        ),
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
            tags: {
              type: 'array',
              items: { type: 'integer' },
              description:
                'Steam tag ids, strongest first. Set for the same game on every platform, ' +
                'so it can be used as a genre.',
            },
            familyKey: nullable('string', {
              description:
                'Shared by the versions of one game across platforms; null when the game has ' +
                'no sibling on another platform.',
            }),
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
            lastPlayedAt: nullable('string', {
              format: 'date-time',
              description: 'When the platform last recorded a session.',
            }),
            playtimeMinutes: {
              type: 'integer',
              description: 'Minutes played as reported by the platform (Steam only; 0 elsewhere).',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description:
                'When Achievers last wrote this progress. `?since=` filters on it, so a partner ' +
                'only rereads what may have changed.',
            },
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
            points: { type: 'integer', description: 'Points the achievement is worth.' },
            missable: {
              type: 'boolean',
              description: 'Can be lost for the current playthrough.',
            },
            unlocked: { type: 'boolean' },
            unlockedAt: nullable('string', { format: 'date-time' }),
          },
        },
      },
    },
  };
}
