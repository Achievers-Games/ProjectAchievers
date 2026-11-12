/** Petit cache de lectures publiques : une seule requête en vol par clé, douze clés au plus. */
export class PublicCache {
  private entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  constructor(
    private readonly maximum = 12,
    private readonly now = Date.now,
  ) {}

  read<T>(key: string, load: () => Promise<T>, ttl = 15_000): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) return cached.value as Promise<T>;
    const entry = { expires: Infinity, value: Promise.resolve().then(load) };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maximum) this.entries.delete(this.entries.keys().next().value!);
    entry.value.then(
      () => {
        entry.expires = this.now() + ttl;
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return entry.value;
  }

  clear() {
    this.entries.clear();
  }
}

export const publicCache = new PublicCache();
export const invalidatePublicCache = () => publicCache.clear();
