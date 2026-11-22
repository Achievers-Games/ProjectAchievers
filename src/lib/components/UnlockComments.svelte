<script lang="ts">
  import { unlockHref } from '#lib/activity';
  import { m } from '#lib/paraglide/messages';
  import MessageCircle from '@lucide/svelte/icons/message-circle';

  /** La bulle d'un déblocage : le nombre de commentaires, et l'accès à sa discussion. */
  let {
    handle,
    id,
    count,
    onclick,
  }: {
    handle: string;
    id: string;
    count: number;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<a
  href={unlockHref(handle, id)}
  {onclick}
  class="tabular flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
  aria-label={m.unlock_comments({ count })}
  title={m.unlock_discussion()}
>
  <MessageCircle size={14} aria-hidden="true" />
  {count}
</a>
