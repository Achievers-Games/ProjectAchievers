import { deserialize } from '$app/forms';
import { m } from '#lib/paraglide/messages';
import { toast } from '#lib/stores/toast';

interface GuideChecks {
  guideId: string;
  checked: number[];
  /** Un visiteur voit les cases, sans pouvoir les enregistrer. */
  enabled: boolean;
  /** Le texte affiché : une traduction remplace les cases, il faut les recocher. */
  html: string;
}

async function save(guideId: string, item: string, checked: boolean) {
  const body = new FormData();
  body.set('guideId', guideId);
  body.set('item', item);
  if (checked) body.set('checked', '1');
  const response = await fetch('?/check', {
    method: 'POST',
    body,
    headers: { 'x-sveltekit-action': 'true' },
  });
  return deserialize(await response.text()).type === 'success';
}

/** Coche les cases d'un guide et enregistre chaque changement. */
export function guideChecks(element: HTMLElement, options: GuideChecks) {
  let current = options;

  const apply = () => {
    for (const box of element.querySelectorAll<HTMLInputElement>('input[data-check]')) {
      box.checked = current.checked.includes(Number(box.dataset.check));
      box.disabled = !current.enabled;
    }
  };

  const onChange = async (event: Event) => {
    const box = event.target as HTMLInputElement;
    const item = box.dataset.check;
    if (item === undefined) return;
    const saved = await save(current.guideId, item, box.checked).catch(() => false);
    if (saved) return;
    box.checked = !box.checked;
    toast(m.action_failed(), 'error');
  };

  apply();
  element.addEventListener('change', onChange);
  return {
    update(next: GuideChecks) {
      current = next;
      apply();
    },
    destroy: () => element.removeEventListener('change', onChange),
  };
}
