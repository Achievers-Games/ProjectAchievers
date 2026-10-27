import { useState } from 'react';
import { Menu, Search, Sparkles } from 'lucide-react';
import { Sidebar } from '@/components/layout/sidebar';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  // Global dashboard search is still a placeholder:
  // consume `debouncedSearch` later when a dedicated IPC is wired up.
  void debouncedSearch;

  return (
    <div className="relative flex h-screen overflow-hidden">
      {/* Ambient warm glow blobs */}
      <div className="ambient-blob -left-40 -top-40 h-[480px] w-[480px]" />
      <div className="ambient-blob right-[-160px] bottom-[-220px] h-[560px] w-[560px]" />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sliding sidebar on mobile, static on desktop */}
      <div
        className={cn(
          'fixed left-0 top-0 z-50 h-full transition-transform duration-300 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <Sidebar />
      </div>

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-4 border-b border-border/60 bg-background/70 backdrop-blur-xl">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-secondary lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative w-full max-w-md">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Rechercher un jeu, un succès…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-full bg-secondary/50 border-border/70 pl-10"
            />
          </div>

          <div className="ml-auto hidden items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent sm:flex">
            <Sparkles className="h-3 w-3" />
            Chasse aux succès
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
