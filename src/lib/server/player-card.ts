import { m } from '#lib/paraglide/messages';
import { formatNumber } from '#lib/labels';
import { logger } from '#lib/logger';

const log = logger('Carte de joueur');

export const CARD_WIDTH = 600;
export const CARD_HEIGHT = 180;
const AVATAR = 104;
const NAME_MAX = 24;

/** Au-delà, ce n'est plus un avatar : la carte s'en passe plutôt que de grossir. */
const AVATAR_MAX_BYTES = 400_000;
const AVATAR_TIMEOUT = 3_000;
const AVATAR_CACHE_MAX = 500;
const AVATAR_TTL = 6 * 60 * 60 * 1000;

export interface PlayerCardData {
  displayName: string;
  handle: string;
  clan: string | null;
  games: number;
  unlocked: number;
  cards: number;
  points: number;
  /** L'image déjà intégrée : un SVG affiché par `<img>` ne charge aucune ressource externe. */
  avatar: string | null;
}

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&apos;',
  '"': '&quot;',
};

export const escapeXml = (value: string) =>
  value.replace(/[&<>'"]/g, (char) => XML_ENTITIES[char] ?? char);

const clip = (value: string, max: number) =>
  [...value].length > max ? `${[...value].slice(0, max - 1).join('')}…` : value;

/** Une bannière autonome, à intégrer sur un autre site, un forum ou un README. */
export function renderPlayerCard(card: PlayerCardData): string {
  const stats = [
    { label: m.stat_games(), value: card.games },
    { label: m.stat_achievements(), value: card.unlocked },
    { label: m.player_card_cards(), value: card.cards },
    { label: m.stat_points(), value: card.points },
  ];
  const initial = escapeXml([...card.displayName.trim()][0]?.toUpperCase() ?? '?');
  const subtitle = card.clan ? `@${card.handle} · ${clip(card.clan, 28)}` : `@${card.handle}`;
  const left = 152;
  const column = (CARD_WIDTH - left - 24) / stats.length;

  const avatar = card.avatar
    ? `<image href="${escapeXml(card.avatar)}" x="28" y="38" width="${AVATAR}" height="${AVATAR}" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="80" cy="90" r="52" fill="#2a1f4a"/><text x="80" y="90" class="initial" text-anchor="middle" dominant-baseline="central">${initial}</text>`;

  const columns = stats
    .map(
      (stat, index) =>
        `<g transform="translate(${left + index * column} 120)">` +
        `<text class="label">${escapeXml(stat.label.toUpperCase())}</text>` +
        `<text y="28" class="value">${escapeXml(formatNumber(stat.value))}</text></g>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(m.player_card_alt({ name: card.displayName }))}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a0f3f"/><stop offset="1" stop-color="#0d0a1c"/></linearGradient>
<clipPath id="avatar"><circle cx="80" cy="90" r="52"/></clipPath>
<style>
text{font-family:'Inter Variable',Inter,'Segoe UI',system-ui,sans-serif;fill:#fff}
.name{font-size:26px;font-weight:800}
.sub{font-size:14px;fill:rgba(255,255,255,.7)}
.label{font-size:11px;font-weight:600;letter-spacing:.06em;fill:rgba(255,255,255,.6)}
.value{font-size:22px;font-weight:800}
.brand{font-size:12px;font-weight:700;letter-spacing:.1em;fill:#c4b5fd}
.initial{font-size:44px;font-weight:800}
</style>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="16" fill="url(#bg)"/>
<rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="15.5" fill="none" stroke="rgba(255,255,255,.12)"/>
${avatar}
<circle cx="80" cy="90" r="52" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/>
<text x="${CARD_WIDTH - 24}" y="32" class="brand" text-anchor="end">ACHIEVERS</text>
<text x="${left}" y="62" class="name">${escapeXml(clip(card.displayName, NAME_MAX))}</text>
<text x="${left}" y="86" class="sub">${escapeXml(subtitle)}</text>
${columns}
</svg>`;
}

const avatars = new Map<string, { data: string | null; at: number }>();

/**
 * Les adresses viennent toujours d'un compte lié (Steam, PSN, Xbox…) : aucune adresse libre.
 * La carte reste utilisable si le serveur d'images est lent ou refuse : l'initiale remplace l'avatar.
 */
export async function inlineAvatar(url: string | null, now = Date.now()): Promise<string | null> {
  if (!url?.startsWith('https://')) return null;
  const cached = avatars.get(url);
  if (cached && now - cached.at < AVATAR_TTL) return cached.data;

  let data: string | null = null;
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(AVATAR_TIMEOUT),
    });
    const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const length = Number(response.headers.get('content-length') ?? 0);
    if (response.ok && /^image\/(png|jpeg|webp|gif)$/.test(type) && length <= AVATAR_MAX_BYTES) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength <= AVATAR_MAX_BYTES) {
        data = `data:${type};base64,${bytes.toString('base64')}`;
      }
    }
  } catch (cause) {
    log.warn('Avatar injoignable :', cause instanceof Error ? cause.message : cause);
  }

  if (avatars.size >= AVATAR_CACHE_MAX) avatars.delete(avatars.keys().next().value!);
  avatars.set(url, { data, at: now });
  return data;
}
