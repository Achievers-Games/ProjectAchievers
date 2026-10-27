import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GameCard } from '@/components/games/GameCard';
import { Gamepad2, RefreshCw, Search } from 'lucide-react';
import { Playstation, Steam } from '@/components/icons';
import { useSync } from '@/hooks/useSync';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

type PlatformFilter = 'all' | 'steam' | 'psn';

export function GamesPage() {
  const [localSearch, setLocalSearch] = useState('');
  const [localPlatform, setLocalPlatform] = useState<PlatformFilter>('all');
  const search = useDebouncedValue(localSearch, 300);
  const sync = useSync();

  const { data: games, isLoading } = useQuery({
    queryKey: ['games-list', search, localPlatform],
    queryFn: () =>
      tauriApi.getGames({
        search: search || undefined,
        platform: localPlatform === 'all' ? undefined : localPlatform,
      }),
  });

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl p-6 lg:p-8 reveal">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,hsl(15_92%_56%/20%),transparent)]" />
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-accent">
              Collection
            </p>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Bibliothèque</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {games?.length ?? 0} jeux découverts
            </p>
          </div>
          <Button className="btn-glossy" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
            {sync.isPending ? 'Synchronisation…' : 'Synchroniser'}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un jeu…"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="rounded-full bg-secondary/50 border-border/70 pl-10"
          />
        </div>
        <Button
          variant={localPlatform === 'all' ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
          onClick={() => setLocalPlatform('all')}
        >
          Tous
        </Button>
        <Button
          variant={localPlatform === 'steam' ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
          onClick={() => setLocalPlatform('steam')}
        >
          <Steam className="h-3 w-3" /> Steam
        </Button>
        <Button
          variant={localPlatform === 'psn' ? 'default' : 'outline'}
          size="sm"
          className="rounded-full"
          onClick={() => setLocalPlatform('psn')}
        >
          <Playstation className="h-3 w-3" /> PlayStation
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="dynamic-card block p-0">
              <div className="aspect-[10/6] skeleton-text rounded-none" />
              <div className="space-y-2 p-4">
                <div className="skeleton-text h-4 w-3/4" />
                <div className="skeleton-text h-2 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : games && games.length === 0 ? (
        <div className="dynamic-card flex flex-col items-center gap-3 p-12 text-center">
          <Gamepad2 className="h-9 w-9 opacity-30" />
          <h3 className="text-lg font-bold">Aucun jeu trouvé</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Liez votre compte Steam pour importer votre bibliothèque.
          </p>
          <Button className="btn-glossy" asChild>
            <Link to="/settings">Lier Steam</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {(games ?? []).map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}
