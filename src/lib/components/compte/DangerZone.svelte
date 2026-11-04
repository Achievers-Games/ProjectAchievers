<script lang="ts">
  import { m } from '#lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { submitWithToast } from '#lib/forms';

  let { handle }: { handle: string } = $props();

  let confirmation = $state('');
  const submit = submitWithToast();
</script>

<section class="space-y-3">
  <h2>{m.personal_data()}</h2>
  <div class="card space-y-4 p-4">
    <a class="btn" href="/compte/export" data-sveltekit-reload>{m.export_data()}</a>
    <form method="POST" action="?/delete" use:enhance={submit} class="space-y-2">
      <label for="confirmation" class="label block">
        {m.delete_account_label({ handle })}
      </label>
      <div class="flex gap-2">
        <input
          id="confirmation"
          name="confirmation"
          bind:value={confirmation}
          autocomplete="off"
          class="input max-w-xs"
        />
        <button class="btn btn-danger" disabled={confirmation !== handle}>
          {m.delete()}
        </button>
      </div>
    </form>
  </div>
</section>
