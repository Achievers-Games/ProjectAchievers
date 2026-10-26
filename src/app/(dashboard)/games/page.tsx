'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GameCard } from '@/components/games/GameCard';
import { Search, Filter, Plus, Gamepad2, Playstation, Steam } from 'lucide-react';
import { getPlatformColor } from '@/lib/utils';

interface GamesPageProps {
  searchParams: Promise<{ platform?: string; search?: string }>;
}

export default function GamesPage({ searchParams }: GamesPageProps) {
  const params = await searchParams;
  const [localSearch, setLocalSearch] = useState(params.search || '');
  const [localPlatform, setLocalPlatform] = useState<'all' | 'steam' | 'psn'>(params.platform === 'steam' || params.platform === 'psn' ? params.platform as any : 'all');

  const { data: games, isLoading } = useQuery({
    queryKey: ['games-list', localSearch, localPlatform],
    queryFn: () => tauriApi.getGames({
      search: localSearch || undefined,
      platform: localPlatform === 'all' ? undefined : localPlatform,
    }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bibliothèque de jeux</h1>
          <p className="text-muted-foreground">
            {games?.length ?? 0} jeux découverts
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-80">
            <Input
              placeholder="Rechercher un jeu…"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              left={<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />}
              className="pl-10"
            />
          </div>
          <Button onClick={() => tauriApi.syncAllPlatforms()}>
            <Plus className="w-4 h-4 mr-2" />
            Synchroniser
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant={localPlatform === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setLocalPlatform('all')}>
          Tous
        </Button>
        <Button variant={localPlatform === 'steam' ? 'default' : 'outline'} size="sm" onClick={() => setLocalPlatform('steam')}>
          <Steam className="w-3 h-3 mr-1" /> Steam
        </Button>
        <Button variant={localPlatform === 'psn' ? 'default' : 'outline'} size="sm" onClick={() => setLocalPlatform('psn')}>
          <Playstation className="w-3 h-3 mr-1" /> PlayStation
        </Button>
      </div>

      {isLoading ? (
        <div className="h-[500px] flex items-center justify-center">
          <div className="skeleton-text h-48 w-full animate-pulse" />
        </div>
      ) : games?.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-muted-foreground opacity-50 text-4xl mb-4">🎮</div>
          <h3 className="text-lg font-medium">Aucun jeu trouvé</h3>
          <p className="text-muted-foreground">Liez votre compte Steam pour importer votre bibliothèque.</p>
          <Button onClick={() => { /* trigger auth flow */ }}>
            <Gamepad2 className="w-4 h-4 mr-2" />
            Lier Steam
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}