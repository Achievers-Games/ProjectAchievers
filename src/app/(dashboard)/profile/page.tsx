'use client';

import { useQuery } from '@tanstack/react-query';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Steam, Playstation, Gamepad2, Trophy2, User, Mail, Settings } from 'lucide-react';
import { getPlatformColor } from '@/lib/utils';
import { formatRelativeDate } from '@/lib/utils';

export default function ProfilePage() {
  const { data: authStatus, isLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: () => tauriApi.getAuthStatus(),
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="skeleton-text h-96 w-full animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mon profil</h1>
          <p className="text-muted-foreground">Gérez votre compte et vos comptes liés</p>
        </div>
      </div>

      {/* Profile Info */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center text-4xl">
              <User className="w-12 h-12" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{authStatus?.username || 'Utilisateur'}</h2>
              <p className="text-muted-foreground">
                {authStatus?.is_authenticated ? 'Connecté' : 'Non connecté'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline">
                <Settings className="w-4 h-4 mr-2" />
                Modifier le profil
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Accounts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Steam className="w-5 h-5" /> Compte Steam
            </CardTitle>
          </CardHeader>
          <CardContent>
            {authStatus?.linked_accounts.find(a => a.platform === 'steam') ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nom d'utilisateur</span>
                  <span className="font-medium">{authStatus.linked_accounts.find(a => a.platform === 'steam')?.platform_username}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Dernière synchronisation</span>
                  <span className="text-sm font-mono text-muted-foreground">
                    {authStatus.linked_accounts.find(a => a.platform === 'steam')?.last_synced_at
                      ? formatRelativeDate(authStatus.linked_accounts.find(a => a.platform === 'steam')!.last_synced_at!)
                      : 'Jamais'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span className="text-muted-foreground">Synchronisé</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Steam className="w-8 h-8 text-muted-foreground mb-2" />
                <h3 className="font-medium">Steam non lié</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Liez votre compte Steam pour importer vos succès.
                </p>
                <Button variant="outline" onClick={() => { /* trigger auth */ }}>
                  Lier Steam
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Playstation className="w-5 h-5" /> Compte PlayStation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {authStatus?.linked_accounts.find(a => a.platform === 'psn') ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nom d'utilisateur</span>
                  <span className="font-medium">{authStatus.linked_accounts.find(a => a.platform === 'psn')?.platform_username}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Dernière synchronisation</span>
                  <span className="text-sm font-mono text-muted-foreground">
                    {authStatus.linked_accounts.find(a => a.platform === 'psn')?.last_synced_at
                      ? formatRelativeDate(authStatus.linked_accounts.find(a => a.platform === 'psn')!.last_synced_at!)
                      : 'Jamais'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-yellow-500">
                  <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                  <span className="text-muted-foreground">API limitée - import manuel requis</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Playstation className="w-8 h-8 text-muted-foreground mb-2" />
                <h3 className="font-medium">PlayStation non liée</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Note: L'API PSN n'est pas publiquement disponible. Utilisez l'import PSNProfiles.
                </p>
                <Button variant="outline" onClick={() => { /* trigger auth */ }}>
                  Lier PSN
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="w-5 h-5" /> Statistiques
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Jeux joués</p>
              <p className="text-2xl font-bold">0</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Objets déverrouillés</p>
              <p className="text-2xl font-bold">0</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Platiniums</p>
              <p className="text-2xl font-bold">0</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Guides créés</p>
              <p className="text-2xl font-bold">0</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}