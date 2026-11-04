import type { SubmitFunction } from '$app/forms';
import { m } from '#lib/paraglide/messages';
import { toast } from '#lib/stores/toast';

/** Retour commun des formulaires : la page se recharge et le résultat arrive en toast. */
export const submitWithToast =
  ({
    reset = true,
    onSuccess,
  }: { reset?: boolean; onSuccess?: (form: HTMLFormElement) => void } = {}): SubmitFunction =>
  ({ formElement }) => {
    return async ({ result, update }) => {
      // Depuis SvelteKit 3, `update` suit par défaut la page où l'action se termine ; un formulaire
      // placé ailleurs (ajout d'ami depuis un profil, par exemple) quitterait alors son écran.
      await update({ reset: reset && result.type === 'success', navigate: false });
      if (result.type === 'failure') {
        toast(String(result.data?.error ?? m.action_failed()), 'error');
      } else if (result.type === 'success') {
        if (result.data?.success) toast(String(result.data.success));
        onSuccess?.(formElement);
      }
    };
  };
