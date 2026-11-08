import {
  API_PLATFORMS,
  API_SORT_KEYS,
  API_STATUS_KEYS,
  KEY_LIMIT,
  LOOKUP_MAX,
  PAGE_LIMIT,
  PAGE_MAX,
} from './partner-api';
import {
  ALMOST_LIMIT,
  ALMOST_MAX,
  POPULAR_LIMIT,
  POPULAR_MAX,
  POPULAR_PERIODS,
} from './partner-queries';
import { OAUTH_SCOPES } from './oauth-provider';

/** Ce que chaque portée ouvre, tel que le partenaire le lit dans la description. */
const OAUTH_SCOPE_DESCRIPTIONS: Record<(typeof OAUTH_SCOPES)[number], string> = {
  profile: 'Name, avatar, clan and stats. Always granted.',
  library: 'Games and progress, even with a private profile.',
  achievements: 'Achievements of each game, unlocked or not.',
};

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
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Project Achievers partner API',
      version: '1.0.0',
      description:
        'Read-only access to public Achievers profiles and games, plus an identity lookup used ' +
        'to link a player account across partner sites. Only public profiles are exposed; games ' +
        'hidden by the player and adult-only games never appear. Secret achievements stay masked ' +
        `until unlocked. Limit: ${KEY_LIMIT} requests per minute per key.`,
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
      '/partner/identities/lookup': {
        post: {
          operationId: 'lookupIdentities',
          summary: 'Achievers accounts holding these verified identities',
          description:
            'Account linking only. Send provider identities you verified yourself (Discord id, ' +
            'SteamID64…). The answer holds account ids, never profile data. One match means the ' +
            'same person; several mean the player has to choose.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['identities'],
                  properties: {
                    identities: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 20,
                      items: {
                        type: 'object',
                        required: ['provider', 'providerUserId'],
                        properties: {
                          provider: {
                            type: 'string',
                            enum: [
                              'STEAM',
                              'DISCORD',
                              'PSN',
                              'XBOX',
                              'GOOGLE',
                              'RETRO',
                              'EPIC',
                              'BLIZZARD',
                            ],
                          },
                          providerUserId: { type: 'string', maxLength: 128 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': ok(
              {
                type: 'object',
                required: ['partnerUserIds'],
                properties: {
                  partnerUserIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Distinct Achievers accounts matching at least one identity.',
                  },
                },
              },
              'The accounts found, empty when none.',
            ),
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/games/{platform}/{id}': {
        get: {
          operationId: 'getGame',
          summary: 'A game from its platform id',
          parameters: [platform, gameId],
          responses: {
            '200': ok(ref('GameCard'), 'The game, with what Achievers knows of its 100 %.'),
            ...errors,
          },
        },
      },
      '/users/{handle}/almost': {
        get: {
          operationId: 'getAlmostFinished',
          summary: "A player's started games, closest to 100 % first",
          parameters: [
            handle,
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: ALMOST_MAX, default: ALMOST_LIMIT },
            },
          ],
          responses: {
            '200': ok(
              {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        game: ref('Game'),
                        progress: ref('Progress'),
                        remaining: {
                          type: 'object',
                          description: 'What is left. Names stay hidden: secrets stay secret.',
                          properties: {
                            achievements: { type: 'integer' },
                            hardestRarity: nullable('number', {
                              description: 'Percent of players with the rarest one left.',
                            }),
                            easiestRarity: nullable('number', {
                              description: 'Percent of players with the most common one left.',
                            }),
                            missable: { type: 'integer' },
                            points: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
              'Fewest achievements left first, then the most common ones.',
            ),
            '400': { $ref: '#/components/responses/BadRequest' },
            ...errors,
          },
        },
      },
      '/games/popular': {
        get: {
          operationId: 'getPopularGames',
          summary: 'Games where achievement hunters are busy',
          parameters: [
            {
              name: 'period',
              in: 'query',
              schema: { type: 'string', enum: Object.keys(POPULAR_PERIODS), default: 'week' },
            },
            {
              name: 'limit',
              in: 'query',
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: POPULAR_MAX,
                default: POPULAR_LIMIT,
              },
            },
          ],
          responses: {
            '200': ok(
              {
                type: 'object',
                properties: {
                  period: { type: 'string' },
                  since: { type: 'string', format: 'date-time' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        game: ref('GameCard'),
                        periodCompletions: {
                          type: 'integer',
                          description: 'Public players who reached 100 % in the period.',
                        },
                        activePlayers: {
                          type: 'integer',
                          description: 'Public players who unlocked something in the period.',
                        },
                      },
                    },
                  },
                },
              },
              'Most 100 % reached first, then most active players.',
            ),
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
          },
        },
      },
      '/games/lookup': {
        post: {
          operationId: 'lookupGames',
          summary: `Up to ${LOOKUP_MAX} games in one call, e.g. a whole library page`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['games'],
                  properties: {
                    games: {
                      type: 'array',
                      minItems: 1,
                      maxItems: LOOKUP_MAX,
                      items: {
                        type: 'object',
                        required: ['platform', 'id'],
                        properties: {
                          platform: { type: 'string', enum: Object.keys(API_PLATFORMS) },
                          id: { type: 'string', description: 'Steam appid for Steam games.' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': ok(
              {
                type: 'object',
                required: ['items', 'missing'],
                properties: {
                  items: {
                    type: 'array',
                    items: ref('GameCard'),
                    description: 'Found games, in request order, duplicates dropped.',
                  },
                  missing: {
                    type: 'array',
                    description: 'Games Achievers does not know, or adult-only ones.',
                    items: {
                      type: 'object',
                      properties: { platform: { type: 'string' }, id: { type: 'string' } },
                    },
                  },
                },
              },
              'The games found, and the ones missing.',
            ),
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
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
        oauth2: {
          type: 'oauth2',
          description:
            'Authorization code with PKCE (S256), confidential client. The token endpoint ' +
            'takes a JSON body, not a form: the site refuses cross-site form posts.',
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/oauth/authorize`,
              tokenUrl: `${origin}/oauth/token`,
              refreshUrl: `${origin}/oauth/token`,
              scopes: OAUTH_SCOPE_DESCRIPTIONS,
            },
          },
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
            cardPngUrl: {
              type: 'string',
              description: 'The same card as a 1200×360 PNG, for Discord and forums.',
            },
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
        GameCard: {
          allOf: [
            ref('Game'),
            {
              type: 'object',
              properties: {
                players: { type: 'integer', description: 'Public players owning it.' },
                completions: { type: 'integer', description: 'Of those, at 100 %.' },
                completionRate: nullable('number', { description: 'Percent, 0-100.' }),
                difficulty: {
                  type: 'object',
                  properties: {
                    missableAchievements: {
                      type: 'integer',
                      description: 'Achievements that can be lost for the current run.',
                    },
                    missablesReviewed: {
                      type: 'boolean',
                      description:
                        'True when an official guide reviewed every achievement: the missable ' +
                        'count is then complete. False: only the known ones are counted.',
                    },
                    rarestAchievement: nullable('number', {
                      description: 'Percent of Steam players who have the rarest achievement.',
                    }),
                  },
                },
                guides: {
                  type: 'object',
                  properties: {
                    achievementsCovered: {
                      type: 'integer',
                      description: 'Achievements with at least one readable guide.',
                    },
                    gameGuides: {
                      type: 'integer',
                      description: 'Full walkthroughs to 100 % for the game.',
                    },
                    bestGameGuideUrl: nullable('string', {
                      description: 'Official walkthrough first, then the best voted one.',
                    }),
                  },
                },
                completionTime: {
                  type: ['object', 'null'],
                  description:
                    'Median playtime of public players at 100 % (Steam playtime). Null under ' +
                    '5 such players: too few to mean anything, and never one player’s time.',
                  properties: {
                    medianMinutes: { type: 'integer' },
                    sample: { type: 'integer', description: 'Players the median is based on.' },
                  },
                },
              },
            },
          ],
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

  /**
   * Les routes `/me` : les mêmes réponses que leurs équivalents publics, pour le joueur qui a
   * donné son accord, même au profil privé. Jeton OAuth au lieu de la clé partenaire.
   */
  // Les routes `/games/lookup` et `/partner/…` sont des POST : on ne lit ici que des GET.
  const paths = spec.paths as unknown as Record<string, { get: Record<string, unknown> }>;
  const me = (
    from: string,
    operationId: string,
    scope: string,
    keep: (parameter: { name: string }) => boolean = () => false,
  ) => {
    const get = paths[from]!.get;
    return {
      get: {
        ...get,
        operationId,
        summary: `${String(get.summary)}, for the player who authorised you`,
        parameters: ((get.parameters ?? []) as { name: string }[]).filter(keep),
        security: [{ oauth2: [scope] }],
      },
    };
  };
  const query = (parameter: { name: string }) => parameter.name !== 'handle';
  Object.assign(paths, {
    '/me': me('/users/{handle}', 'getMe', 'profile'),
    '/me/games': me('/users/{handle}/games', 'listMyGames', 'library', query),
    '/me/games/{platform}/{id}': me(
      '/users/{handle}/games/{platform}/{id}',
      'getMyGame',
      'achievements',
      query,
    ),
    '/me/almost': me('/users/{handle}/almost', 'getMyAlmostFinished', 'library', query),
  });
  return spec;
}
