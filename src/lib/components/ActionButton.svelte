<script lang="ts">
  import { enhance } from '$app/forms';
  import { submitWithToast } from '#lib/forms';

  let {
    action,
    id,
    label,
    danger = false,
  }: { action: string; id: string; label: string; danger?: boolean } = $props();

  const submit = submitWithToast();
</script>

<form method="POST" action="?/{action}" use:enhance={submit}>
  <input type="hidden" name="id" value={id} />
  <button class="btn h-8" class:btn-danger={danger}>{label}</button>
</form>
