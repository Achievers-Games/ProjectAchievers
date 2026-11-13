import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env';

interface Key {
  /** Empreinte courte de la clé, écrite devant chaque contenu : elle dit laquelle a servi. */
  id: string;
  bytes: Buffer;
}

const toKey = (hex: string): Key => {
  const bytes = Buffer.from(hex, 'hex');
  return { id: createHash('sha256').update(bytes).digest('base64url').slice(0, 8), bytes };
};

let ring: { source: string; current: Key; all: Key[] } | undefined;

/**
 * La clé en service, et celles qui l'ont précédée. Changer de clé se fait sans rien perdre :
 * la nouvelle va dans `ENCRYPTION_KEY`, l'ancienne dans `ENCRYPTION_KEY_PREVIOUS`. Ce qui est
 * déjà chiffré reste lisible, et le balayage horaire le rechiffre avec la nouvelle clé
 * (`rewrapSecrets`) ; l'ancienne se retire une fois qu'il ne reste plus rien sous elle.
 */
function keyring() {
  const { ENCRYPTION_KEY, ENCRYPTION_KEY_PREVIOUS } = env();
  const source = `${ENCRYPTION_KEY},${ENCRYPTION_KEY_PREVIOUS ?? ''}`;
  if (ring?.source !== source) {
    const current = toKey(ENCRYPTION_KEY);
    const previous = (ENCRYPTION_KEY_PREVIOUS ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(toKey);
    ring = { source, current, all: [current, ...previous] };
  }
  return ring;
}

/** Chiffre en AES-256-GCM. Format : clé.iv.tag.texte, en base64url. */
export function encrypt(plaintext: string): string {
  const { current } = keyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.bytes, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const sealed = [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url'));
  return [current.id, ...sealed].join('.');
}

function open(key: Key, parts: string[]): string {
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Contenu chiffré invalide');
  // La longueur du tag est imposée : un tag raccourci affaiblirait la vérification d'intégrité.
  const decipher = createDecipheriv('aes-256-gcm', key.bytes, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function decrypt(sealed: string): string {
  const parts = sealed.split('.');
  const { all } = keyring();
  if (parts.length === 4) {
    const key = all.find((candidate) => candidate.id === parts[0]);
    if (!key) throw new Error('Contenu chiffré avec une clé inconnue');
    return open(key, parts.slice(1));
  }
  // Ancien format, sans nom de clé : antérieur à la rotation, donc sous l'une des clés connues.
  let failure: unknown = new Error('Contenu chiffré invalide');
  for (const key of all) {
    try {
      return open(key, parts);
    } catch (cause) {
      failure = cause;
    }
  }
  throw failure;
}

/** Vrai quand le contenu est déjà sous la clé en service, au format qui la nomme. */
export const isUnderCurrentKey = (sealed: string) => sealed.startsWith(currentKeyPrefix());

/** Ce par quoi commence tout contenu chiffré avec la clé en service. */
export const currentKeyPrefix = () => `${keyring().current.id}.`;

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');
