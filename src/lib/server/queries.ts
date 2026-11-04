/**
 * Les lectures du site, rangées par domaine. Ce baril garde les chemins d'import existants
 * (`#lib/server/queries`) et laisse chaque domaine se lire seul.
 */
export * from './queries/shared';
export * from './queries/library';
export * from './queries/stats';
export * from './queries/feeds';
export * from './queries/profile';
export * from './queries/compare';
export * from './queries/leaderboard';
export * from './queries/banners';
