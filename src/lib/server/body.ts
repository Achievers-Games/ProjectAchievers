/**
 * Lit le corps sans jamais dépasser `limit` octets : une requête énorme est refusée sans être
 * chargée. Renvoie `null` au-delà de la limite, une chaîne vide si le client est parti.
 */
export async function readSmallBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // Client parti avant la fin : la réponse ne l'intéresse plus.
    return '';
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
