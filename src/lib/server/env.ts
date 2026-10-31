import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ORIGIN: z.url(),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'doit contenir 32 octets en hexadécimal'),
  STEAM_API_KEY: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  XBOX_CLIENT_ID: z.string().optional(),
  XBOX_CLIENT_SECRET: z.string().optional(),
  PSN_SERVICE_NPSSO: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_AI_TOKEN: z.string().optional(),
  DEV_LOGIN: z.string().optional(),
  SYNC_CONCURRENCY: z.coerce.number().int().min(1).default(2),
});

type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Valide la configuration au premier accès : sans secret valide, le serveur refuse de démarrer. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuration invalide : ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
