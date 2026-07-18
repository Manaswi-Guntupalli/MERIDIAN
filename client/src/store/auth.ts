import { create } from 'zustand';
import { api, TOKEN_KEY } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';
import type { User } from '@/types';

/** Where the Super Admin's own token waits during impersonation. Session
 *  storage on purpose: closing the tab ends the disguise, never persists it. */
const ORIGINAL_TOKEN_KEY = 'meridian_original_token';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  logoutAll: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  impersonate: (userId: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  login: async (email, password, rememberMe) => {
    const { data } = await api.post('/auth/login', { email, password, rememberMe });
    localStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
    set({ user: { ...data.user, mustChangePassword: data.mustChangePassword }, loading: false });
  },
  logout: () => {
    void api.post('/auth/logout').catch(() => {}); // best-effort audit entry
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
    disconnectSocket(); // drop the authenticated realtime channel too
    set({ user: null });
  },
  logoutAll: async () => {
    await api.post('/auth/logout-all');
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
    disconnectSocket();
    set({ user: null });
  },
  changePassword: async (currentPassword, newPassword) => {
    const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
    // The server rotates the token (old sessions are revoked); adopt the new one.
    localStorage.setItem(TOKEN_KEY, data.token);
    set({ user: { ...data.user, mustChangePassword: false } });
  },
  impersonate: async (userId) => {
    const { data } = await api.post(`/auth/impersonate/${userId}`);
    // Stash the real identity, wear the target's.
    const current = localStorage.getItem(TOKEN_KEY);
    if (current) sessionStorage.setItem(ORIGINAL_TOKEN_KEY, current);
    localStorage.setItem(TOKEN_KEY, data.token);
    disconnectSocket(); // reconnect as the impersonated user
    set({ user: data.user });
  },
  exitImpersonation: async () => {
    const original = sessionStorage.getItem(ORIGINAL_TOKEN_KEY);
    sessionStorage.removeItem(ORIGINAL_TOKEN_KEY);
    if (!original) {
      get().logout();
      return;
    }
    localStorage.setItem(TOKEN_KEY, original);
    disconnectSocket();
    await get().fetchMe();
  },
  fetchMe: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({ user: null, loading: false });
      return;
    }
    try {
      const { data } = await api.get('/auth/me');
      set({ user: { ...data.user, mustChangePassword: data.mustChangePassword }, loading: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ user: null, loading: false });
    }
  },
}));
