'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AchievementCard } from '@/components/achievements/AchievementCard';
import { GameDetail, AchievementWithProgress } from '@/lib/tauri';
import { RefreshCw, ChevronLeft, Playstation, Steam, Trophy2 } from 'lucide-react';
import Link from 'next/link';
import { getPlatformColor } from '@/lib/utils';

interface GameDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default function GameDetailPage({ params }: GameDetailPageProps) {
  const { slug } = await params;
  const [gameId, setGameId] = useState<string>('');

  const { data: game, isLoading } = useQuery<GameDetail | null>({
    queryKey: ['game-detail', slug],
    queryFn: async () => {
      // First search to get the game ID
      const results = await tauriApi.searchGames(slug, 1);
      if (results.length === 0) return null;
      setGameId(results[0].id);
      return tauriApi.getGameDetail(results[0].id);
    },
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="skeleton-text h-96 w-full animate-pulse" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="flex h-screen flex-col items-center justify-center text-center">
        <h2 className="text-2xl font-bold mb-4">Jeu non trouvé</h2>
        <Button asChild>
          <Link href="/dashboard/games">
            <ChevronLeft className="w-4 h-4 mr-2" />
            Retour à la bibliothèque
          </Link>
        </Button>
      </div>
    );
  }

  const progress = game.user_progress;
  const platinumAchievement = game.achievements.find(a => a.is_platinum);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          {game.cover_url && (
            <img
              src={game.cover_url}
              alt={game.name}
              className="w-48 h-48 object-cover rounded-xl shadow-lg"
            />
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border', getPlatformColor(game.platform))}>
                {game.platform.charAt(0).toUpperCase() + game.platform.slice(1)}
              </span>
              {game.platinum_achievement_id && (
                <Badge variant="outline" className="badge-platinum border text-xs font-medium">
                  🏆 Platine disponible
                </Badge>
              )}
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{game.name}</h1>
            <p className="text-muted-foreground mt-1">
              {progress?.total_count} objets • {progress?.unlocked_count} déverrouillés
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => tauriApi.forceSyncGame(game.id)}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Ré-synchroniser
          </Button>
          <Button variant="outline">
            <Playstation className="w-4 h-4 mr-2" />
            PSN
          </Button>
        </div>
      </div>

      {/* Progress */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Progression" value={`${progress?.completion_percentage.toFixed(1)}%`} subtitle={`${progress?.unlocked_count}/${progress?.total_count}`} />
        <StatCard title="Objets déverrouillés" value={String(progress?.unlocked_count ?? 0)} subtitle={`Total: ${progress?.total_count}`} />
        <StatCard title="Platine" value={progress?.platinum_unlocked ? 'Oui' : 'Non'} subtitle={platinumAchievement ? platinumAchievement.name : 'Non obtenu'} />
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Progression globale</span>
          <span>{progress?.completion_percentage.toFixed(1)}%</span>
        </div>
        <Progress value={progress?.completion_percentage ?? 0} className="h-3" />
      </div>

      {/* Achievements */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Objets ({game.achievements.length})</h2>
          <p className="text-sm text-muted-foreground">
            {game.achievements.filter(a => a.unlocked).length} déverrouillés
          </p>
        </div>
        <Button size="sm" variant="outline">
          <RefreshCw className="w-3 h-3 mr-1" />
          Trier
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {game.achievements.map((achievement) => (
          <AchievementCard key={achievement.id} achievement={achievement} />
        ))}
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined | null | boolean)[]): string {
  return classes.filter(Boolean).join(' ');
}

function StatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <Card className="p-4">
      <CardHeader className="p-3 pb-1">
        <p className="text-xs text-muted-foreground">{title}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold">{value}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}