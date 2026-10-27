import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';

/**
 * Runs a full sync of all platforms, invalidates related queries
 * and surfaces errors through a toast notification.
 */
export function useSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => tauriApi.syncAllPlatforms(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['games-list'] });
      queryClient.invalidateQueries({ queryKey: ['game-detail'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });

      const games = result.total_games;
      const achievements = result.total_achievements;
      const errors = [...result.steam.errors, ...result.psn.errors];

      if (errors.length > 0) {
        toast.error(`Synchronisation partielle : ${errors.length} erreur(s)`, {
          description: errors[0],
        });
      } else {
        toast.success('Synchronisation terminée', {
          description: `${games} jeu(x) • ${achievements} succès`,
        });
      }
    },
    onError: (error) => {
      toast.error('Échec de la synchronisation', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
}
