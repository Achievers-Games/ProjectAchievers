import { Link } from 'react-router-dom';
import { AchievementWithProgress } from '@/lib/tauri';
import { getTrophyIcon } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface AchievementCardProps {
  achievement: AchievementWithProgress;
  className?: string;
}

export function AchievementCard({ achievement, className }: AchievementCardProps) {
  const iconUrl = achievement.unlocked ? achievement.icon_url : achievement.icon_gray_url;

  return (
    <Link
      to={`/achievements/${achievement.id}`}
      className={cn(
        'achievement-card group flex items-center gap-4 cursor-pointer',
        achievement.unlocked ? 'unlocked border-primary/30 bg-primary/5' : 'locked',
        className
      )}
    >
      <div className="relative w-20 h-20 shrink-0">
        <img
          src={iconUrl || '/placeholder.svg'}
          alt={achievement.name}
          className="w-full h-full object-cover rounded-lg"
          loading="lazy"
        />
        {achievement.hidden && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <span className="text-muted-foreground">???</span>
          </div>
        )}
        {achievement.unlocked && (
          <div className="absolute -right-1 -bottom-1 w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md">
            ?
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium">{getTrophyIcon(achievement.trophy_type)}</span>
          {achievement.trophy_type && (
            <Badge variant="outline" className="text-xs">
              {achievement.trophy_type.charAt(0).toUpperCase() + achievement.trophy_type.slice(1)}
            </Badge>
          )}
        </div>
        <h4 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
          {achievement.name}
        </h4>
        <p className="text-xs text-muted-foreground line-clamp-1">
          {achievement.description || 'Description non disponible'}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] font-mono text-muted-foreground">
            {(achievement.global_rarity ?? 0).toFixed(1)}% joueurs
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {achievement.points} pts
          </span>
        </div>
      </div>
      {achievement.unlocked && achievement.unlocked_at && (
        <span className="text-xs text-muted-foreground font-mono">
          {new Date(achievement.unlocked_at).toLocaleDateString('fr-FR')}
        </span>
      )}
    </Link>
  );
}
