import crypto from 'crypto';

// Generate a secure random state parameter
export function generateState(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

// Generate PKCE code verifier (43-128 characters)
export function generatePkceVerifier(length: number = 64): string {
  return crypto.randomBytes(length).toString('base64url');
}

// Generate PKCE code challenge from verifier (S256)
export async function generatePkceChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

// Generate OAuth authorize URL with PKCE
export function buildOAuthUrl(
  authorizeUrl: string,
  params: Record<string, string>
): string {
  const url = new URL(authorizeUrl);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

// Parse OAuth callback query parameters
export function parseOAuthCallback(query: Record<string, string | string[]>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    result[key] = Array.isArray(value) ? value[0] : value;
  }
  return result;
}

// Store PKCE verifier (in production, use Redis or database)
const pkceStore = new Map<string, { verifier: string; expiresAt: number }>();

export function storePkceVerifier(state: string, verifier: string): void {
  pkceStore.set(state, {
    verifier,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
}

export function getAndRemovePkceVerifier(state: string): string | null {
  const entry = pkceStore.get(state);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pkceStore.delete(state);
    return null;
  }
  pkceStore.delete(state);
  return entry.verifier;
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pkceStore.entries()) {
    if (now > entry.expiresAt) {
      pkceStore.delete(state);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes