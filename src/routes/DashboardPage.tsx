import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/components/games/GameCard';
import { RefreshCw, Gamepad2, Trophy, Star, Sparkles, ArrowRight } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { useSync } from '@/hooks/useSync';

export function DashboardPage() {
  const sync = useSync();

  const { data: games, isLoading: gamesLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => tauriApi.getGames(),
  });

  const { data: authStatus } = useQuery({
    queryKey: ['auth'],
    queryFn: () => tauriApi.getAuthStatus(),
  });

  const stats = {
    totalGames: games?.length ?? 0,
    totalAchievements: games?.reduce((acc, g) => acc + g.total_achievements, 0) ?? 0,
    unlocked: games?.reduce((acc, g) => acc + (g.user_progress?.unlocked_count ?? 0), 0) ?? 0,
    platinums: games?.filter((g) => g.user_progress?.platinum_unlocked).length ?? 0,
  };

  const nearComplete = games
    ?.filter(
      (g) =>
        g.user_progress &&
        !g.user_progress.platinum_unlocked &&
        (g.user_progress.completion_percentage ?? 0) > 0,
    )
    .sort(
      (a, b) => (b.user_progress?.completion_percentage ?? 0) - (a.user_progress?.completion_percentage ?? 0),
    )
    .slice(0, 3) ?? [];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="dynamic-card reveal">
        <div className="relative overflow-hidden rounded-2xl p-6 sm:p-8">
          {/* Warm glow accents */}
          <div className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,hsl(15_92%_56%/25%),transparent)]" />
          <div className="pointer-events-none absolute -bottom-32 right-0 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,hsl(42_95%_55%/18%),transparent)]" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
                <Sparkles className="h-3 w-3" />
                Saison · Automne 2026
              </p>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                Bonjour, <span className="stat-numeral">{authStatus?.username || 'Chasseur'}</span>
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Ta bibliothèque, tes trophées, tes guides — tout au même endroit pour développer
                ta collection, un succès à la fois.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 lg:pb-1">
              <Button className="btn-glossy" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
                {sync.isPending ? 'Synchronisation…' : 'Synchroniser'}
              </Button>
              <Link
                to="/games"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border px-4 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Explorer la bibliothèque
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Jeux"
          value={formatNumber(stats.totalGames)}
          icon={<Gamepad2 className="h-4 w-4" />}
          className="reveal reveal-delay-1"
        />
        <StatCard
          title="Succès"
          value={formatNumber(stats.totalAchievements)}
          icon={<Trophy className="h-4 w-4" />}
          className="reveal reveal-delay-1"
        />
        <StatCard
          title="Déverrouillés"
          value={formatNumber(stats.unlocked)}
          icon={<Star className="h-4 w-4" />}
          className="reveal reveal-delay-2"
        />
        <StatCard
          title="Platiniums"
          value={formatNumber(stats.platinums)}
          icon={<Trophy className="h-4 w-4" />}
          className="reveal reveal-delay-3"
        />
      </section>

      {/* Near-complete + library */}
      {nearComplete.length > 0 && (
        <section className="reveal">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-bold">Presse-boutons</h2>
              <p className="text-xs text-muted-foreground">Tu es tout proche du platine.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {nearComplete.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}

      {/* Library */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold">Ta bibliothèque</h2>
            <p className="text-xs text-muted-foreground">{formatNumber(stats.totalGames)} jeux découverts</p>
          </div>
          <Link
            to="/games"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Tout voir
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {gamesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
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
          <div className="dynamic-card flex flex-col items-center gap-3 p-10 text-center">
            <Trophy className="h-9 w-9 opacity-30" />
            <p className="text-sm text-muted-foreground">
              Aucun jeu trouvé. Liez votre compte Steam pour commencer.
            </p>
            <Button asChild>
              <Link to="/settings">Lier Steam</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {games?.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  className,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`dynamic-card p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
        <div className="rounded-xl bg-secondary/60 p-2 text-muted-foreground">{icon}</div>
      </div>
      <p className="stat-numeral mt-2 text-2xl sm:text-3xl">{value}</p>
    </div>
  );
}
