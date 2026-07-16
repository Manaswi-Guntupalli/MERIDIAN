import { create } from 'zustand';
import type { Severity } from '@/types';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  severity: Severity;
}

interface UIState {
  paletteOpen: boolean;
  setPalette: (v: boolean) => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  setPalette: (v) => set({ paletteOpen: v }),
  toasts: [],
  pushToast: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
