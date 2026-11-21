import { deserialize, type SubmitFunction } from '$app/forms';
import { m } from '#lib/paraglide/messages';
import { toast } from '#lib/stores/toast';

/** Appelle une action de la page courante hors formulaire, et rend son résultat. */
export async function postAction(action: string, fields: Record<string, string> = {}, query = '') {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const response = await fetch(`?/${action}${query ? `&${query}` : ''}`, {
    method: 'POST',
    body,
    headers: { 'x-sveltekit-action': 'true' },
  });
  return deserialize(await response.text());
}

/** Demande un motif puis signale le contenu par l'action `action` de la page. */
export async function reportContent(
  action: string,
  fields: Record<string, string> = {},
  query = '',
) {
  const reason = prompt(m.report_prompt());
  if (!reason) return;
  const result = await postAction(action, { ...fields, reason }, query);
  if (result.type === 'success') toast(m.report_sent());
  else {
    const message = result.type === 'failure' ? result.data?.error : null;
    toast(String(message ?? m.report_failed()), 'error');
  }
}

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
