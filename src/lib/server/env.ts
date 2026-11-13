import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ORIGIN: z.url(),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'doit contenir 32 octets en hexadécimal'),
  /**
   * Anciennes clés, séparées par des virgules : elles ne servent plus qu'à relire ce qui n'a pas
   * encore été rechiffré avec `ENCRYPTION_KEY`.
   */
  ENCRYPTION_KEY_PREVIOUS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(
        /^[0-9a-f]{64}([\s,]+[0-9a-f]{64})*$/i,
        'doit lister des clés de 32 octets en hexadécimal',
      )
      .optional(),
  ),
  /** Dossier des sauvegardes, monté en lecture seule : le site alerte si la dernière est trop vieille. */
  BACKUP_DIR: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  STEAM_API_KEY: z.string().optional(),
  BLIZZARD_CLIENT_ID: z.string().optional(),
  BLIZZARD_CLIENT_SECRET: z.string().optional(),
  EPIC_CLIENT_ID: z.string().optional(),
  EPIC_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  XBOX_CLIENT_ID: z.string().optional(),
  XBOX_CLIENT_SECRET: z.string().optional(),
  PSN_SERVICE_NPSSO: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  RETRO_API_KEY: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_CONTACT: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_AI_TOKEN: z.string().optional(),
  DEV_LOGIN: z.string().optional(),
  SYNC_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  SYNC_GAME_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  STEAM_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  BACKGROUND_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  BLIZZARD_DETAILS_PER_RUN: z.coerce.number().int().min(1).max(3000).default(100),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  /** Boîte qui reçoit les messages du formulaire de contact. Par défaut, SMTP_FROM. */
  // Docker Compose transmet une chaîne vide quand la variable n'est pas définie.
  CONTACT_INBOX: z.preprocess((value) => (value === '' ? undefined : value), z.email().optional()),
  /** Lure : liaison automatique des comptes, par les identités OAuth communes. */
  // Vide tant que Lure n'est pas branché : Docker Compose transmet alors une chaîne vide.
  LURE_API_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
  LURE_API_KEY: z.string().optional(),
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
