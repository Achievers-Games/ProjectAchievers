import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTheme } from 'next-themes';
import { Shield, AlertTriangle, Loader2 } from 'lucide-react';
import { Steam, Playstation } from '@/components/icons';

type ThemeChoice = 'system' | 'light' | 'dark';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [steamId, setSteamId] = useState('');

  const { data: authStatus, isError } = useQuery({
    queryKey: ['auth'],
    queryFn: () => tauriApi.getAuthStatus(),
  });

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['auth'] });
    queryClient.invalidateQueries({ queryKey: ['games'] });
    queryClient.invalidateQueries({ queryKey: ['games-list'] });
  };

  const authenticateSteamMutation = useMutation({
    mutationFn: (id: string) => tauriApi.authenticateSteam({ steam_id: id }),
    onSuccess: () => {
      toast.success('Compte Steam lié');
      setSteamId('');
      invalidateQueries();
    },
    onError: (error) => {
      toast.error('Échec de la liaison Steam', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const unlinkAccountMutation = useMutation({
    mutationFn: (accountId: string) => tauriApi.unlinkAccount(accountId),
    onSuccess: () => {
      toast.success('Compte dissocié');
      invalidateQueries();
    },
    onError: () => {
      toast.error('Échec de la dissociation');
    },
  });

  const steamAccount = authStatus?.linked_accounts.find((a) => a.platform === 'steam');
  const psnAccount = authStatus?.linked_accounts.find((a) => a.platform === 'psn');

  const themeOptions: { label: string; value: ThemeChoice }[] = [
    { label: 'Système', value: 'system' },
    { label: 'Clair', value: 'light' },
    { label: 'Sombre', value: 'dark' },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Paramètres</h1>
        <p className="text-muted-foreground">Gérez vos comptes et préférences</p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Impossible de récupérer le statut des comptes.</p>
      )}

      {/* Account Linking */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" /> Comptes liés
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Steam */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 flex items-center justify-center">
                <Steam className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium">Steam</h3>
                <p className="text-sm text-muted-foreground">Importez vos succès Steam</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {steamAccount ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="px-2 py-1">
                    <span className="w-2 h-2 rounded-full bg-green-500 mr-2 inline-block" />
                    Connecté
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={unlinkAccountMutation.isPending}
                    onClick={() => unlinkAccountMutation.mutate(steamAccount.id)}
                  >
                    Dissocier
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Votre ID Steam (64-bit)"
                    className="w-48"
                    value={steamId}
                    onChange={(e) => setSteamId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && steamId.trim()) {
                        authenticateSteamMutation.mutate(steamId.trim());
                      }
                    }}
                  />
                  <Button
                    disabled={!steamId.trim() || authenticateSteamMutation.isPending}
                    onClick={() => authenticateSteamMutation.mutate(steamId.trim())}
                  >
                    {authenticateSteamMutation.isPending && (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    )}
                    Lier
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* PSN */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-300 flex items-center justify-center">
                <Playstation className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium">PlayStation Network</h3>
                <p className="text-sm text-muted-foreground">Importez vos trophées PSN</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {psnAccount ? (
                <Badge variant="secondary" className="px-2 py-1">
                  <span className="w-2 h-2 rounded-full bg-green-500 mr-2 inline-block" />
                  Connecté
                </Badge>
              ) : (
                <Button variant="outline" size="sm">
                  Lier PSN
                </Button>
              )}
            </div>
          </div>

          {/* PSN Info */}
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/40 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                  API PSN limitée
                </p>
                <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                  Sony ne propose pas d'API publique pour les trophées. La synchronisation PSN
                  nécessite soit une clé API officielle, soit l'import manuel depuis PSNProfiles.com.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Apparence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Thème</h3>
              <p className="text-sm text-muted-foreground">Système, clair ou sombre</p>
            </div>
            <div className="flex gap-2">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={theme === option.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>À propos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Project Achievers v0.1.0
            <br />
            Application communautaire pour chasseurs de succès
          </p>
          <div className="flex gap-4 mt-4">
            <Button variant="outline" size="sm" asChild>
              <a href="https://github.com/ProjectAchievers" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="https://github.com/ProjectAchievers/issues" target="_blank" rel="noopener noreferrer">
                Signaler un bug
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
