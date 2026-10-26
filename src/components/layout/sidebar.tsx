'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Gamepad2,
  Trophy,
  User,
  Settings,
  RefreshCw,
  Search,
  LogOut,
  BarChart3,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { tauriApi } from '@/lib/tauri';

interface SidebarProps {
  className?: string;
}

const navigation = [
  { name: 'Tableau de bord', href: '/dashboard', icon: Gamepad2 },
  { name: 'Bibliothèque', href: '/dashboard/games', icon: Trophy },
  { name: 'Recherche', href: '/dashboard/search', icon: Search },
  { name: 'Profil', href: '/dashboard/profile', icon: User },
  { name: 'Paramètres', href: '/dashboard/settings', icon: Settings },
];

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-full w-64 border-r border-border bg-background z-50 flex flex-col',
        className
      )}
    >
      <div className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white">
            🏆
          </div>
          <span className="font-bold text-lg tracking-tight">Achievers</span>
        </div>
        <button className="text-muted-foreground hover:text-foreground transition-colors lg:hidden">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-1',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        <button
          onClick={() => tauriApi.syncAllPlatforms()}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-secondary"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            <span>Synchroniser</span>
          </div>
          <span className="text-xs text-muted-foreground">⟳</span>
        </button>
      </div>
    </aside>
  );
}

export function MobileSidebar() {
  // Mobile sidebar toggle would go here
  return null;
}