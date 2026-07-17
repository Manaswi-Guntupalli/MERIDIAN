import { create } from 'zustand';
import type { Severity } from '@/types';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  severity: Severity;
}

const RAIL_KEY = 'meridian_sidebar_collapsed';

interface UIState {
  paletteOpen: boolean;
  setPalette: (v: boolean) => void;
  /** Sidebar collapsed to an icon rail — persisted across sessions. */
  railed: boolean;
  toggleRail: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  setPalette: (v) => set({ paletteOpen: v }),
  railed: localStorage.getItem(RAIL_KEY) === '1',
  toggleRail: () =>
    set((s) => {
      const railed = !s.railed;
      localStorage.setItem(RAIL_KEY, railed ? '1' : '0');
      return { railed };
    }),
  toasts: [],
  pushToast: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
