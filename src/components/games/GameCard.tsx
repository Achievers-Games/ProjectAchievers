'use client';

import Link from 'next/link';
import { Image } from '@/components/ui/image';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { GameListItem } from '@/lib/tauri';
import { cn, formatRelativeDate, getPlatformColor, getTrophyIcon } from '@/lib/utils';

interface GameCardProps {
  game: GameListItem;
}

export function GameCard({ game }: GameCardProps) {
  const completion = game.user_progress?.completion_percentage ?? 0;
  const hasPlatinum = game.user_progress?.platinum_unlocked ?? false;

  return (
    <Link
      href={`/dashboard/games/${game.slug}`}
      className={cn(
        'achievement-card group',
        game.user_progress?.platinum_unlocked ? 'unlocked' : ''
      )}
    >
      <div className="relative h-32 overflow-hidden rounded-lg mb-3">
        {game.cover_url ? (
          <Image src={game.cover_url} alt={game.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full bg-secondary flex items-center justify-center">
            <span className="text-muted-foreground">{getTrophyIcon(game.platform as any)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <Badge
          className="absolute top-2 left-2 z-10 text-xs font-medium"
          variant="outline"
        >
          <span className={cn('flex items-center gap-1', getPlatformColor(game.platform))}>
            {getTrophyIcon(game.platform as any)}
            {game.platform.charAt(0).toUpperCase() + game.platform.slice(1)}
          </span>
        </Badge>
        {hasPlatinum && (
          <Badge className="absolute top-2 right-2 z-10 badge-platinum border text-xs font-medium">
            🏆 Platine
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
          {game.name}
        </h3>

        <div className="flex items-center gap-2">
          <Progress value={completion} className="h-2 w-32" />
          <span className="text-xs text-muted-foreground font-mono">
            {completion.toFixed(0)}%
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {game.user_progress?.unlocked_count}/{game.total_achievements}
          </span>
          {game.user_progress?.last_unlocked_at && (
            <span>{formatRelativeDate(game.user_progress.last_unlocked_at)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}