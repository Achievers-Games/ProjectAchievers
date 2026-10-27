import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { tauriApi, type SteamResolvedProfile } from '@/lib/tauri';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Shield, Gamepad2, Loader2, Search, Sparkles, UserCheck } from 'lucide-react';

export function LoginPage() {
  const [query, setQuery] = useState('');
  const [lastSearched, setLastSearched] = useState('');
  const [resolution, setResolution] = useState<SteamResolvedProfile | null>(null);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const navigate = useNavigate();

  // Debounced search (~450 ms) on every keystroke: the Steam API only
  // allows exact resolution of a pseudo (ResolveVanityURL), so we try to
  // resolve whatever is typed once the user pauses.
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      if (!trimmed || linking) {
        setResolution(null);
        setSearching(false);
        return;
      }
      if (lastSearched === trimmed) {
        setSearching(false);
        return;
      }
      setSearching(true);
      setLastSearched(trimmed);
      try {
        const profile = await tauriApi.steamResolveVanity(trimmed);
        setResolution(profile);
      } catch {
        setResolution(null);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [query, linking, lastSearched]);

  const resultShown =
    !linking && !searching && query.trim() && lastSearched === query.trim();

  const handleLinkProfile = async (profile: SteamResolvedProfile) => {
    setLinking(true);
    try {
      await tauriApi.authenticateSteam({ steam_id: profile.steamid });
      toast.success('Compte Steam lié');
      navigate('/');
    } catch (error) {
      toast.error('Échec de la liaison Steam', {
        description: error instanceof Error ? error.message : String(error),
      });
      setLinking(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-background via-background to-secondary/40 px-4">
      {/* Ambient warm glow */}
      <div className="ambient-blob -top-40 left-1/2 h-96 w-96 -translate-x-1/2" />
      <div className="ambient-blob -bottom-48 -right-32 h-96 w-96" />

      <Card className="dynamic-card w-full max-w-md p-1">
        <CardHeader className="text-center space-y-1">
          <div className="mb-4 flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Project <span className="stat-numeral">Achievers</span>
            </h1>
          </div>
          <CardTitle>Lier un compte Steam</CardTitle>
          <CardDescription>
            Tapez votre pseudo Steam : votre profil apparaît ci-dessous, cliquez dessus pour le
            lier.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Votre pseudo Steam…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-full bg-secondary/50 pl-10"
              disabled={linking}
            />
          </div>

          {/* Resolved profile card (single, exact match) */}
          {resolution && resultShown && (
            <div
              className="dynamic-card group cursor-pointer p-3"
              onClick={() => handleLinkProfile(resolution)}
            >
              <div className="flex items-center gap-3">
                <img
                  src={resolution.avatar}
                  alt={resolution.personaname}
                  className="h-11 w-11 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{resolution.personaname}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {resolution.steamid}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                  {linking ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <UserCheck className="h-3 w-3" />
                  )}
                  {linking ? 'Liaison…' : 'Lier'}
                </span>
              </div>
            </div>
          )}

          {/* Searching */}
          {searching && !resolution && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 p-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Recherche du profil…
            </div>
          )}

          {/* No result */}
          {resultShown && !resolution && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 p-5 text-center">
              <Gamepad2 className="h-6 w-6 opacity-30" />
              <p className="text-xs text-muted-foreground">
                Aucun profil Steam trouvé pour{' '}
                <span className="font-semibold text-foreground">{query.trim()}</span>
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                Steam exige un pseudo exact (celui de l'URL steamcommunity.com/id/…).
              </p>
            </div>
          )}

          {/* Linking state */}
          {linking && !resolution && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border/60 p-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Liaison du compte…
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-accent">
            <Sparkles className="h-3 w-3" />
            PlayStation · import manuel PSNProfiles à venir
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <p className="text-center text-xs text-muted-foreground">
            Pas de compte Steam ? Vous pouvez utiliser l'application sans lier de compte.
          </p>
          <Button variant="outline" asChild className="w-full rounded-full">
            <Link to="/">
              <Shield className="mr-2 h-4 w-4" />
              Continuer sans compte
            </Link>
          </Button>
        </CardFooter>
      </Card>

      <div className="mt-8 max-w-md text-center">
        <p className="text-sm text-muted-foreground">
          Note PlayStation :{' '}
          <span className="italic">
            L'API PSN n'est pas publiquement disponible. L'intégration PSN nécessitera une clé API
            officielle ou l'import manuel depuis PSNProfiles.com.
          </span>
        </p>
      </div>
    </div>
  );
}
