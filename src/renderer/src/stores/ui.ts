import { create } from "zustand";
import type { SyncReport } from "@shared/models";

export type ViewId =
  | "home"
  | "projects"
  | "project"
  | "agents"
  | "git"
  | "board"
  | "brain"
  | "inbox"
  | "explore"
  | "setup";

interface Place {
  view: ViewId;
  params: Record<string, string>;
}

const samePlace = (a: Place, b: Place): boolean =>
  a.view === b.view && JSON.stringify(a.params) === JSON.stringify(b.params);

interface UiState {
  view: ViewId;
  params: Record<string, string>;
  /** Where the owner has been, so back and forward (top bar, mouse buttons, Alt+arrows) work. */
  history: Place[];
  /** Index of the current place in `history`. */
  at: number;
  navigate: (view: ViewId, params?: Record<string, string>) => void;
  back: () => void;
  forward: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  syncing: boolean;
  syncReport: SyncReport | null;
  setSyncing: (syncing: boolean) => void;
  setSyncReport: (report: SyncReport | null) => void;
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

const MAX_HISTORY = 100;

export const useUi = create<UiState>((set, get) => ({
  view: "home",
  params: {},
  history: [{ view: "home", params: {} }],
  at: 0,
  navigate: (view, params = {}) => {
    const next: Place = { view, params };
    const { history, at } = get();
    const here = history[at];
    if (here && samePlace(here, next)) return set({ view, params });
    // Going somewhere new drops whatever was ahead, like a browser's history, then keeps the last 100.
    const kept = [...history.slice(0, at + 1), next].slice(-MAX_HISTORY);
    set({ view, params, history: kept, at: kept.length - 1 });
  },
  back: () => {
    const { history, at } = get();
    const to = history[at - 1];
    if (to) set({ view: to.view, params: to.params, at: at - 1 });
  },
  forward: () => {
    const { history, at } = get();
    const to = history[at + 1];
    if (to) set({ view: to.view, params: to.params, at: at + 1 });
  },
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  syncing: false,
  syncReport: null,
  setSyncing: (syncing) => set({ syncing }),
  setSyncReport: (syncReport) => set({ syncReport }),
  switcherOpen: false,
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}));
