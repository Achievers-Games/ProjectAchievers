/**
 * Ce qui relie les joueurs : amis, discussions et clans, rangés par sujet. Ce baril garde les
 * chemins d'import existants (`$lib/server/social`) et laisse chaque sujet se lire seul.
 */
export * from './social/shared';
export * from './social/friends';
export * from './social/chat';
export * from './social/clans';
