/** Les genres de nouvelles que la cloche de l'en-tête présente. */
export type NoticeKind =
  'message' | 'invite_friend' | 'invite_clan' | 'clan_request' | 'clan_rename' | 'unlock' | 'card';

/** Une ligne du centre de notifications, telle que le panneau l'affiche. */
export interface Notice {
  /** Stable et unique dans la liste : `message:<id>`, `unlock:<id>`… */
  id: string;
  kind: NoticeKind;
  /** Date de l'événement, en ISO : l'écran en fait « il y a 5 min ». */
  at: string;
  href: string;
  /** Le nom de la personne, du clan, du succès ou du jeu. */
  title: string;
  /** Le jeu d'un succès, l'aperçu d'un message. */
  detail?: string | null;
  /** La langue de l'aperçu, pour y appliquer le bon filtre de grossièretés. */
  detailLocale?: string | null;
  icon?: string | null;
  unread: boolean;
  /** Messages non lus de la discussion. */
  count?: number;
}
