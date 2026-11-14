import type { postAction } from '#lib/forms';
import { m } from '#lib/paraglide/messages';
import { toast } from '#lib/stores/toast';

/** Un texte que le visiteur peut lire traduit : guide ou commentaire. */
export interface Translatable {
  id: string;
  html: string;
  translatedHtml: string | null;
  autoTranslate: boolean;
}

type ActionResult = Awaited<ReturnType<typeof postAction>>;

/** Au-delà, une page longue ne dépense pas tout le quota de traduction d'un coup. */
const MAX_AUTO_TRANSLATIONS = 10;

/**
 * Les traductions d'une page. Chaque traduction reste en mémoire : revenir à l'original puis à
 * la traduction est immédiat. `request` appelle l'action de la page qui traduit un texte.
 */
export class Translations<T extends Translatable = Translatable> {
  #cache = $state<Record<string, { html: string; shown: boolean }>>({});
  /** Le texte en cours de traduction, pour désactiver son bouton. */
  pending = $state<string | null>(null);
  // Lu seulement par `auto` : il ne doit pas relancer l'effet qui l'appelle.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- volontairement non réactif
  #attempted = new Set<string>();

  constructor(private readonly request: (item: T) => Promise<ActionResult>) {}

  /** La traduction connue : demandée sur cette page, ou déjà envoyée par le serveur. */
  of(item: T) {
    return (
      this.#cache[item.id] ??
      (item.translatedHtml ? { html: item.translatedHtml, shown: true } : undefined)
    );
  }

  /** Le HTML à afficher : la traduction si elle est montrée, sinon l'original. */
  html(item: T) {
    const translation = this.of(item);
    return translation?.shown ? translation.html : item.html;
  }

  /** Demande la traduction. Renvoie le message d'erreur, ou une chaîne vide en cas de succès. */
  async fetch(item: T): Promise<string> {
    this.pending = item.id;
    try {
      const result = await this.request(item);
      if (result.type === 'success') {
        this.#cache[item.id] = { html: String(result.data?.html), shown: true };
        return '';
      }
      return String((result.type === 'failure' && result.data?.error) || m.translate_failed());
    } catch {
      return m.translate_failed();
    } finally {
      this.pending = null;
    }
  }

  /** Le bouton du visiteur : bascule entre original et traduction, la demande au besoin. */
  async toggle(item: T) {
    const known = this.of(item);
    if (known) {
      this.#cache[item.id] = { html: known.html, shown: !known.shown };
      return;
    }
    const failure = await this.fetch(item);
    if (failure) toast(failure, 'error');
  }

  /**
   * Traduit d'office les textes que leur lecteur veut dans sa langue, un par un et
   * discrètement : un quota épuisé laisse simplement les textes d'origine. À appeler dans un
   * `$effect`, dont il renvoie le nettoyage.
   */
  auto(items: T[]) {
    let cancelled = false;
    const pending = items
      .filter((item) => item.autoTranslate && !item.translatedHtml && !this.#attempted.has(item.id))
      .slice(0, MAX_AUTO_TRANSLATIONS);
    void (async () => {
      for (const item of pending) {
        this.#attempted.add(item.id);
        if (cancelled) return;
        if (await this.fetch(item)) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }
}
