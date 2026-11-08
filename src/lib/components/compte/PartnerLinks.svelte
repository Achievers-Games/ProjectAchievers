<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { partnerLabel } from '#lib/labels';
  import { submitWithToast } from '#lib/forms';

  interface PartnerLink {
    partner: string;
    method: string;
  }

  let { partners }: { partners: PartnerLink[] } = $props();

  const submit = submitWithToast();
</script>

{#if partners.length}
  <section class="space-y-3">
    <h2>{m.partner_accounts()}</h2>
    <ul class="card divide-y divide-line">
      {#each partners as link (link.partner)}
        <li class="flex flex-wrap items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1 space-y-1">
            <p class="font-medium">{partnerLabel(link.partner)}</p>
            <p class="text-sm text-muted">
              {link.method === 'AUTO' ? m.partner_auto() : m.partner_manual()}
            </p>
          </div>
          <form method="POST" action="?/unlinkPartner" use:enhance={submit}>
            <input type="hidden" name="partner" value={link.partner} />
            <button class="btn btn-ghost">{m.partner_unlink()}</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>
{/if}
