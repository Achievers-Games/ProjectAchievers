/** Les succès d'un DLC, quand l'éditeur ne les sépare pas lui-même sur Steam. */
interface KnownDlc {
  /** L'appid du DLC. */
  id: number;
  name: string;
  /** Les noms d'API Steam de ses succès. */
  achievements: string[];
}

/**
 * Par appid du jeu. N'y entre qu'une liste vérifiée : les succès du DLC tels qu'une autre
 * plateforme les range à part, retrouvés un à un sur Steam.
 */
export const KNOWN_DLC: Record<string, KnownDlc[]> = {
  // The Messenger : les huit succès du DLC sur Xbox, aux mêmes noms, ferment la liste Steam.
  '764790': [
    {
      id: 1107180,
      name: 'Picnic Panic',
      achievements: [
        'DEFEAT_OCTO',
        'DEFEAT_TOTEM',
        'DEFEAT_PUNCH_OUT',
        'PERFECT_RACE',
        'BUY_TOY',
        'UNLOCK_MASK',
        'UNCLOG_SINK',
        'DO_THE_DEAL',
      ],
    },
  ],
};

export type AchievementGroups = Map<string, { groupId: string; groupName: string }>;

/**
 * Complète les groupes publiés par Steam avec les DLC connus. Un succès que l'éditeur range déjà
 * hors du jeu de base garde son groupe : sa liste fait foi.
 */
export function withKnownDlc(appId: string, groups: AchievementGroups | undefined) {
  const known = KNOWN_DLC[appId];
  if (!known) return groups;
  const completed: AchievementGroups = new Map(groups);
  for (const dlc of known) {
    for (const achievement of dlc.achievements) {
      const current = completed.get(achievement);
      if (current && current.groupId !== 'default') continue;
      completed.set(achievement, { groupId: `dlc:${dlc.id}`, groupName: dlc.name });
    }
  }
  return completed;
}
