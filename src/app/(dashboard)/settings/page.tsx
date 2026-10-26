'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Steam, Playstation, Shield, AlertTriangle, RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  const { data: authStatus } = useQuery({
    queryKey: ['auth'],
    queryFn: () => tauriApi.getAuthStatus(),
  });

  const authenticateSteamMutation = useMutation({
    mutationFn: (steamId: string) => tauriApi.authenticateSteam({ steam_id: steamId }),
    onSuccess: () => {
      // Refresh auth status
      window.location.reload();
    },
  });

  const unlinkAccountMutation = useMutation({
    mutationFn: (accountId: string) => tauriApi.unlinkAccount(accountId),
    onSuccess: () => {
      window.location.reload();
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Paramètres</h1>
        <p className="text-muted-foreground">Gérez vos comptes et préférences</p>
      </div>

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
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                <Steam className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium">Steam</h3>
                <p className="text-sm text-muted-foreground">Importez vos succès Steam</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {authStatus?.linked_accounts.some(a => a.platform === 'steam') ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="px-2 py-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    Connecté
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => unlinkAccountMutation.mutate(authStatus.linked_accounts.find(a => a.platform === 'steam')?.id!)}>
                    Dissocier
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Votre ID Steam (64-bit)"
                    className="w-48"
                    onKeyDown={(e) => e.key === 'Enter' && authenticateSteamMutation.mutate(e.currentTarget.value)}
                  />
                  <Button
                    disabled={authenticateSteamMutation.isPending}
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="Votre ID Steam (64-bit)"]') as HTMLInputElement;
                      authenticateSteamMutation.mutate(input.value);
                    }}
                  >
                    Lier
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* PSN */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center">
                <Playstation className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-medium">PlayStation Network</h3>
                <p className="text-sm text-muted-foreground">Importez vos trophées PSN</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {authStatus?.linked_accounts.some(a => a.platform === 'psn') ? (
                <Badge variant="secondary" className="px-2 py-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
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
          <div className="p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800">API PSN limitée</p>
                <p className="text-xs text-yellow-700 mt-1">
                  Sony ne propose pas d'API publique pour les trophées. La synchronisation PSN nécessite soit une clé API officielle, soit l'import manuel depuis PSNProfiles.com.
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
              <Button variant="outline" size="sm">Système</Button>
              <Button variant="outline" size="sm">Clair</Button>
              <Button variant="outline" size="sm">Sombre</Button>
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
            Project Achievers v0.1.0<br/>
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