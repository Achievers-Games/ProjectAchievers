/**
 * Ce qu'une revue Steam change pour les points du joueur : soit ses succès comptent, soit ils
 * attendent une validation sans compter, soit le jeu est bloqué. La fenêtre d'information et les
 * notifications partent de cet état.
 */
export type SteamReviewState = 'pending' | 'blocked' | 'unblocked';

type Review = {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  suspendedAt: Date | null;
  openedAt: Date;
};

export function steamReviewState(review: Review): SteamReviewState | null {
  if (review.suspendedAt || review.status === 'REJECTED') return 'blocked';
  if (review.status === 'PENDING') return 'pending';
  // Validé d'office sans avoir été ouvert : le joueur n'a jamais rien vu, rien à lui dire.
  return review.openedAt.getTime() > 0 ? 'unblocked' : null;
}
