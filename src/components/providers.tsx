'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// Auth context
interface AuthContextType {
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
  linkedAccounts: any[];
  loading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [linkedAccounts, setLinkedAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const status = await window.__TAURI__.invoke('get_auth_status');
      setIsAuthenticated(status.isAuthenticated);
      setUserId(status.user_id ?? null);
      setUsername(status.username ?? null);
      setLinkedAccounts(status.linked_accounts ?? []);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const login = () => {
    // Trigger OAuth flow via Tauri
    window.__TAURI__.invoke('authenticate_steam', { steam_id: '', api_key: undefined });
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUserId(null);
    setUsername(null);
    setLinkedAccounts([]);
  };

  if (!AuthContext.Provider) {
    return children;
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, userId, username, linkedAccounts, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}