import { NavLink } from 'react-router-dom';
import {
  Gamepad2,
  User,
  Settings,
  RefreshCw,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSync } from '@/hooks/useSync';

const navigation = [
  { name: 'Bibliothèque', to: '/games', icon: Gamepad2 },
  { name: 'Profil', to: '/profile', icon: User },
  { name: 'Paramètres', to: '/settings', icon: Settings },
];

export function Sidebar() {
  const sync = useSync();

  return (
    <aside className="fixed left-0 top-0 h-full w-64 border-r border-border bg-background z-50 flex flex-col">
      <div className="flex items-center gap-2 px-6 py-5">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white">
          𚏅
        </div>
        <span className="font-bold text-lg tracking-tight">Achievers</span>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-1',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )
            }
          >
            <item.icon className="w-4 h-4 shrink-0" />
            {item.name}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-4">
        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className={cn('w-4 h-4', sync.isPending && 'animate-spin')} />
            <span>{sync.isPending ? 'Synchronisation…' : 'Synchroniser'}</span>
          </div>
          {sync.isPending && <Search className="w-4 h-4 text-muted-foreground" />}
        </button>
      </div>
    </aside>
  );
}
