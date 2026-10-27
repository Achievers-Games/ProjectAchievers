import { Link } from 'react-router-dom';
import { Image } from '@/components/ui/image';
import { Progress } from '@/components/ui/progress';
import { GameListItem } from '@/lib/tauri';
import { cn, formatRelativeDate, getPlatformColor, getTrophyIcon } from '@/lib/utils';
import { Trophy } from 'lucide-react';

interface GameCardProps {
  game: GameListItem;
}

export function GameCard({ game }: GameCardProps) {
  const completion = game.user_progress?.completion_percentage ?? 0;
  const hasPlatinum = game.user_progress?.platinum_unlocked ?? false;
  const isComplete = completion >= 100;

  return (
    <Link
      to={`/games/${game.slug}`}
      className="dynamic-card shimmer-sweep group block reveal"
    >
      {/* Cover art — full-bleed 10/6 */}
      <div className="relative aspect-[10/6] overflow-hidden">
        {game.cover_url ? (
          <Image
            src={game.cover_url}
            alt={game.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <span className="text-3xl opacity-40">{getTrophyIcon(game.platform as any)}</span>
          </div>
        )}

        {/* Bottom fade for badges & legibility */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />

        {/* Platform pill */}
        <span
          className={cn(
            'absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
            'border backdrop-blur-md bg-black/40 text-[11px] font-semibold text-white',
            getPlatformColor(game.platform).replace(/text-|bg-|border-/g, ''),
          )}
        >
          {getTrophyIcon(game.platform as any)}
          {game.platform.charAt(0).toUpperCase() + game.platform.slice(1)}
        </span>

        {/* Platinum / 100% corner medallion */}
        {hasPlatinum && (
          <span className="badge-platinum absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md bg-black/40">
            <Trophy className="h-3 w-3" />
            Platine
          </span>
        )}
        {!hasPlatinum && isComplete && (
          <span className="badge-gold absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md bg-black/40">
            100%
          </span>
        )}

        {/* Completion ring over art */}
        <div className="absolute bottom-3 right-3 z-10">
          <CompletionRing value={completion} />
        </div>
      </div>

      {/* Body */}
      <div className="space-y-2.5 p-4">
        <h3 className="font-semibold leading-snug line-clamp-1 transition-colors group-hover:text-primary">
          {game.name}
        </h3>

        <div className="flex items-center gap-3">
          <Progress value={completion} className="h-1.5 flex-1" />
          <span className="text-[11px] font-mono text-muted-foreground">
            {completion.toFixed(0)}%
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-mono">
            {game.user_progress?.unlocked_count ?? 0}/{game.total_achievements} succès
          </span>
          {game.user_progress?.last_unlocked_at && (
            <span>{formatRelativeDate(game.user_progress.last_unlocked_at)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CompletionRing({ value }: { value: number }) {
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={pct >= 100 ? 'hsl(45 95% 55%)' : 'hsl(15 92% 56%)'}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-700"
      />
      <text
        x="50%"
        y="54%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize="11"
        fontWeight="700"
      >
        {pct.toFixed(0)}
      </text>
    </svg>
  );
}
