const buckets = new Map<string, { count: number; resetAt: number }>();

/** Limite par fenêtre fixe, en mémoire : suffisant pour un seul processus Node. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** Vrai si la clé a déjà épuisé sa fenêtre, sans compter cette requête. */
export function isRateLimited(key: string, limit: number, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  return bucket !== undefined && bucket.resetAt > now && bucket.count >= limit;
}
