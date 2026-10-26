'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tauriApi } from '@/lib/tauri';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Steam, Playstation, Shield, Mail, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const [steamId, setSteamId] = useState('');
  const [isSteamLoading, setIsSteamLoading] = useState(false);
  const router = useRouter();

  const handleSteamLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSteamLoading(true);
    try {
      await tauriApi.authenticateSteam({ steam_id: steamId });
      router.push('/dashboard');
    } catch (error) {
      console.error('Steam login failed:', error);
    } finally {
      setIsSteamLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background via-background to-secondary/50 px-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-white">
              🏆
            </div>
            <h1 className="text-2xl font-bold">Project Achievers</h1>
          </div>
          <CardTitle>Connexion</h1>
          <CardDescription>
            Liez vos comptes de plateforme pour importer vos succès et trophées.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-secondary/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
                  <Steam className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">Steam</h3>
                  <p className="text-xs text-muted-foreground">
                    Entrez votre ID Steam (64-bit) pour lier votre compte
                  </p>
                </div>
              </div>
              <div className="text-xs font-medium text-muted-foreground">
                •
              </div>
            </div>

            <form onSubmit={handleSteamLogin} className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="ID Steam (17 chiffres)"
                  value={steamId}
                  onChange={(e) => setSteamId(e.target.value)}
                  className="flex-1"
                  disabled={isSteamLoading}
                />
                <Button
                  type="submit"
                  disabled={!steamId || isSteamLoading}
                  className="w-auto"
                >
                  {isSteamLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 2 5.373 2 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      Liaison…
                    </>
                  ) : (
                    <>
                      Lier <ArrowRight className="ml-2 w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
              {steamId && !/^\d{17}$/.test(steamId) && (
                <p className="text-xs text-destructive">
                  L'ID Steam doit contenir 17 chiffres
                </p>
              )}
            </form>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <div className="text-center text-sm text-muted-foreground">
            <p>Pas de compte Steam ? Vous pouvez utiliser l'application sans lier de compte.</p>
          </div>
          <Button variant="outline" asChild className="w-full">
            <Link href="/dashboard">
              <Shield className="w-4 h-4 mr-2" />
              Continuer sans compte
            </Link>
          </Button>
        </CardFooter>
      </Card>

      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground">
          Note PlayStation:{' '}
          <span className="text-sm font-medium text-muted-foreground italic">
            L'API PSN n'est pas publiquement disponible par Sony. L'intégration PSN nécessitera une clé API officielle ou l'import manuel depuis PSNProfiles.com.
          </span>
        </p>
      </div>
    </div>
  );
}