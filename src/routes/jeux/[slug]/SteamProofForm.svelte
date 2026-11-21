<script lang="ts">
  import { enhance } from '$app/forms';
  import { m } from '#lib/paraglide/messages';
  import { submitWithToast } from '#lib/forms';
  import { formatDate } from '#lib/labels';

  let { sentAt }: { sentAt: Date | null } = $props();
  const submit = submitWithToast();

  /** Une capture reste lisible à 1600 px de large ; le serveur ne reçoit pas de fichier énorme. */
  const MAX_WIDTH = 1600;
  async function shrink(file: File) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) =>
      new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.85));
    // Safari n'encode pas le WebP et rend un PNG bien plus lourd : le JPEG prend alors le relais.
    let blob = await encode('image/webp');
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg');
    if (!blob) return file;
    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `preuve.${extension}`, { type: blob.type });
  }

  async function pick(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const small = await shrink(file).catch(() => file);
    const transfer = new DataTransfer();
    transfer.items.add(small);
    input.files = transfer.files;
  }
</script>

<details class="rounded-md border border-line bg-surface p-3 text-sm">
  <summary class="cursor-pointer font-semibold">{m.steam_proof_title()}</summary>
  <form
    method="POST"
    action="?/steamProof"
    enctype="multipart/form-data"
    use:enhance={submit}
    class="mt-2 space-y-2"
  >
    <p class="text-muted">{m.steam_proof_detail()}</p>
    <input
      type="file"
      name="image"
      accept="image/png,image/jpeg,image/webp"
      onchange={pick}
      class="block w-full text-sm"
    />
    <textarea
      name="message"
      maxlength="500"
      rows="2"
      class="input w-full"
      placeholder={m.steam_proof_placeholder()}></textarea>
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted">
        {#if sentAt}{m.steam_proof_last({ date: formatDate(sentAt) })}{/if}
      </span>
      <button class="btn btn-secondary" type="submit">{m.steam_proof_send()}</button>
    </div>
  </form>
</details>
