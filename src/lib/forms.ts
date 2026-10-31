import type { SubmitFunction } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import { toast } from '$lib/stores/toast';

/** Retour commun des formulaires : la page se recharge et le résultat arrive en toast. */
export const submitWithToast =
  ({
    reset = true,
    onSuccess,
  }: { reset?: boolean; onSuccess?: (form: HTMLFormElement) => void } = {}): SubmitFunction =>
  ({ formElement }) => {
    return async ({ result, update }) => {
      await update({ reset: reset && result.type === 'success' });
      if (result.type === 'failure') {
        toast(String(result.data?.error ?? m.action_failed()), 'error');
      } else if (result.type === 'success') {
        if (result.data?.success) toast(String(result.data.success));
        onSuccess?.(formElement);
      }
    };
  };
