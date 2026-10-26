'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GameCard } from '@/components/games/GameCard';
import { Plus, Trophy, Gamepad2, RefreshCw, User, BarChart3 } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export default function DashboardPage() {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'steam' | 'psn'>('all');

  const { data: games, isLoading: gamesLoading } = useQuery({
    queryKey: ['games', search, platformFilter],
    queryFn: () => tauriApi.getGames({ search: search || undefined, platform: platformFilter === 'all' ? undefined : platformFilter }),
  });

  const { data: authStatus } = useQuery({
    queryKey: ['auth'],
    queryFn: () => tauriApi.getAuthStatus(),
  });

  const stats = {
    totalGames: games?.length ?? 0,
    totalAchievements: games?.reduce((acc, g) => acc + g.total_achievements, 0) ?? 0,
    unlocked: games?.reduce((acc, g) => acc + (g.user_progress?.unlocked_count ?? 0), 0) ?? 0,
    platinums: games?.filter(g => g.user_progress?.platinum_unlocked).length ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tableau de bord</h1>
          <p className="text-muted-foreground">
            Bienvenue, {authStatus?.username || 'Joueur'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-64">
            <Input
              placeholder="Rechercher un jeu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              left={<span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>}
              className="pl-10"
            />
          </div>
          <Button onClick={() => tauriApi.syncAllPlatforms()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Synchroniser
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Jeux dans la bibliothèque" value={formatNumber(stats.totalGames)} icon={<Gamepad2 className="w-5 h-5" />} color="text-primary" />
        <StatCard title="Total d'objets" value={formatNumber(stats.totalAchievements)} icon={<Trophy className="w-5 h-5" />} color="text-yellow-500" />
        <StatCard title="Déverrouillés" value={formatNumber(stats.unlocked)} icon={<Plus className="w-5 h-5" />} color="text-green-500" />
        <StatCard title="Platiniums" value={formatNumber(stats.platinums)} icon={<User className="w-5 h-5" />} color="text-purple-500" />
      </div>

      {/* Recommendations Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Votre bibliothèque</h2>
            <Button size="sm" variant="outline" onClick={() => tauriApi.syncAllPlatforms()}>
              <RefreshCw className="w-3 h-3 mr-1" />
              Actualiser
            </Button>
          </div>

          {gamesLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="skeleton-text h-48 rounded-lg w-full animate-pulse" />
            </div>
          ) : games?.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Aucun jeu trouvé. Liez votre compte Steam pour commencer.</p>
              <Button onClick={() => { /* trigger auth */ }}>Lier Steam</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {games.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-lg">Actions rapides</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => tauriApi.getAuthStatus()}>
                <User className="w-4 h-4 mr-2" />
                Compte
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => tauriApi.syncAllPlatforms()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Synchroniser les plateformes
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => tauriApi.checkForUpdates()}>
                <BarChart3 className="w-4 h-4 mr-2" />
                Vérifier les mises à jour
              </Button>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-lg">Recommandations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Les recommandations apparaîtront ici basées sur vos jeux platinés.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <Card className="glass-card">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className="p-1.5 rounded-md bg-secondary/50 text-muted-foreground">{icon}</div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold {color}">{value}</span>
        </div>
      </CardContent>
    </Card>
  );
}