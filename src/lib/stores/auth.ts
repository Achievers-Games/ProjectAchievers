import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { tauriApi, runOAuth, type SessionTokens, type AuthStatus, type LinkedAccount } from '@/lib/tauri';
import { toast } from './toast';

// ── Types ──────────────────────────────────────────────────────────────
export interface AuthState {
    isAuthenticated: boolean;
    userId: string | null;
    username: string | null;
    linkedAccounts: LinkedAccount[];
    accessToken: string | null;
    refreshToken: string | null;
    accessExpiresAt: number | null;
    refreshExpiresAt: number | null;
    sessionId: string | null;
}

// ── Stores ─────────────────────────────────────────────────────────────
const initialState: AuthState = {
    isAuthenticated: false,
    userId: null,
    username: null,
    linkedAccounts: [],
    accessToken: null,
    refreshToken: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
    sessionId: null,
};

function createAuthStore() {
    const { subscribe, set, update } = writable<AuthState>(initialState);

    let refreshPromise: Promise<string> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Helpers ──────────────────────────────────────────────────────
    function scheduleRefresh(expiresAt: number) {
        if (refreshTimer) clearTimeout(refreshTimer);
        const now = Date.now();
        // Refresh 30 seconds before expiry
        const delay = Math.max(0, expiresAt - now - 30_000);
        refreshTimer = setTimeout(() => {
            void refreshAccessToken();
        }, delay);
    }

    async function persistTokens(tokens: SessionTokens) {
        if (!browser) return;
        localStorage.setItem('pa_access_token', tokens.access_token);
        localStorage.setItem('pa_refresh_token', tokens.refresh_token);
        localStorage.setItem('pa_access_expires', tokens.access_expires_at.toString());
        localStorage.setItem('pa_refresh_expires', tokens.refresh_expires_at.toString());
        localStorage.setItem('pa_session_id', tokens.session_id);
    }

    async function clearPersistedTokens() {
        if (!browser) return;
        localStorage.removeItem('pa_access_token');
        localStorage.removeItem('pa_refresh_token');
        localStorage.removeItem('pa_access_expires');
        localStorage.removeItem('pa_refresh_expires');
        localStorage.removeItem('pa_session_id');
    }

    function loadPersistedTokens(): Partial<AuthState> | null {
        if (!browser) return null;
        const accessToken = localStorage.getItem('pa_access_token');
        const refreshToken = localStorage.getItem('pa_refresh_token');
        const accessExpiresAt = localStorage.getItem('pa_access_expires');
        const refreshExpiresAt = localStorage.getItem('pa_refresh_expires');
        const sessionId = localStorage.getItem('pa_session_id');

        if (!accessToken || !refreshToken || !accessExpiresAt || !refreshExpiresAt || !sessionId) {
            return null;
        }

        return {
            accessToken,
            refreshToken,
            accessExpiresAt: parseInt(accessExpiresAt, 10),
            refreshExpiresAt: parseInt(refreshExpiresAt, 10),
            sessionId,
        };
    }

    // ── Public API ───────────────────────────────────────────────────
    async function init() {
        const persisted = loadPersistedTokens();
        if (persisted) {
            update((state) => ({
                ...state,
                ...persisted,
                isAuthenticated: true, // optimistic, will be validated
            }));
            scheduleRefresh(persisted.accessExpiresAt!);
            try {
                await validateSession(persisted.accessToken!);
            } catch {
                // Token invalid/expired, try refresh
                try {
                    await refreshAccessToken();
                } catch {
                    await logout();
                }
            }
        } else {
            // No persisted tokens, check auth status anyway
            await loadAuthStatus();
        }
    }

    async function loadAuthStatus() {
        try {
            const status: AuthStatus = await tauriApi.getAuthStatus();
            update((state) => ({
                ...state,
                isAuthenticated: status.is_authenticated,
                userId: status.user_id ?? null,
                username: status.username ?? null,
                linkedAccounts: status.linked_accounts ?? [],
            }));
        } catch {
            // Not authenticated
            update((state) => ({ ...state, isAuthenticated: false }));
        }
    }

    async function validateSession(accessToken: string) {
        const session = await tauriApi.validateSession(accessToken);
        update((state) => ({
            ...state,
            isAuthenticated: true,
            userId: session.user_id,
            sessionId: session.session_id,
        }));
        return session;
    }

    async function refreshAccessToken(): Promise<string> {
        // Prevent multiple simultaneous refreshes
        if (refreshPromise) return refreshPromise;

        const state = get(auth);
        const refreshToken = state.refreshToken;
        if (!refreshToken) throw new Error('No refresh token available');

        refreshPromise = (async () => {
            const result = await tauriApi.refreshSession(refreshToken);
            update((s) => ({
                ...s,
                accessToken: result.access_token,
                accessExpiresAt: result.access_expires_at,
            }));
            await persistTokens({
                access_token: result.access_token,
                refresh_token: refreshToken,
                access_expires_at: result.access_expires_at,
                refresh_expires_at: state.refreshExpiresAt!,
                session_id: state.sessionId!,
            });
            scheduleRefresh(result.access_expires_at);
            return result.access_token;
        })();

        try {
            return await refreshPromise;
        } finally {
            refreshPromise = null;
        }
    }

    async function loginWithOAuth(provider: 'steam' | 'discord') {
        const result = await runOAuth(provider);
        if (!result.success) {
            toast.error(
                provider === 'steam' ? 'Connexion Steam échouée' : 'Connexion Discord échouée',
                result.error,
            );
            throw new Error(result.error);
        }
        // After OAuth, a session should be created. Load auth status.
        await loadAuthStatus();
        toast.success(provider === 'steam' ? 'Compte Steam lié' : 'Compte Discord lié');
    }

    async function createSession(userAgent?: string) {
        const tokens = await tauriApi.createSession(userAgent);
        await persistTokens(tokens);
        update((state) => ({
            ...state,
            isAuthenticated: true,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            accessExpiresAt: tokens.access_expires_at,
            refreshExpiresAt: tokens.refresh_expires_at,
            sessionId: tokens.session_id,
        }));
        scheduleRefresh(tokens.access_expires_at);
        await loadAuthStatus();
        return tokens;
    }

    async function logout(revokeServer = true) {
        const state = get(auth);
        if (revokeServer && state.sessionId) {
            try {
                await tauriApi.revokeSession(state.sessionId);
            } catch {
                // Ignore server errors, we clear locally anyway
            }
        }
        if (refreshTimer) clearTimeout(refreshTimer);
        await clearPersistedTokens();
        set(initialState);
    }

    async function revokeAllOtherSessions() {
        const state = get(auth);
        if (!state.sessionId) return;
        const count = await tauriApi.revokeOtherSessions(state.sessionId);
        toast.success(`${count} autre session${count > 1 ? 's' : ''} révoquée${count > 1 ? 's' : ''}`);
        await loadAuthStatus();
    }

    async function getSessions() {
        return await tauriApi.getSessions();
    }

    return {
        subscribe,
        init,
        loadAuthStatus,
        createSession,
        loginWithOAuth,
        logout,
        revokeAllOtherSessions,
        getSessions,
        refreshAccessToken,
    };
}

export const auth = createAuthStore();

// ── Derived stores ────────────────────────────────────────────────────
export const isAuthenticated = derived(auth, ($auth) => $auth.isAuthenticated);
export const currentUser = derived(auth, ($auth) => ($auth.userId ? { id: $auth.userId, username: $auth.username } : null));

// ── Fetch wrapper with automatic token refresh ────────────────────────
const EXCLUDED_URLS = ['/auth/', '/oauth/'];

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const state = get(auth);

    // Skip auth for non-API calls
    const url = input instanceof Request ? input.url : String(input);
    if (EXCLUDED_URLS.some((ex) => url.includes(ex))) {
        return fetch(input, init);
    }

    if (!state.isAuthenticated || !state.accessToken) {
        return fetch(input, init);
    }

    // Check if token is about to expire
    if (state.accessExpiresAt && Date.now() > state.accessExpiresAt - 60_000) {
        try {
            await auth.refreshAccessToken();
        } catch {
            // Refresh failed, redirect to login
            auth.logout();
            if (browser) {
                window.location.href = '/settings';
            }
            throw new Error('Session expired');
        }
    }

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${state.accessToken}`);

    return fetch(input, { ...init, headers });
}

// ── Re-export tauriApi for other uses ────────────────────────────────
export { tauriApi };