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
  | "setup"
  | "tools"
  | "workflows"
  | "usage"
  | "gallery";

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
  /** Counts every move to a place, even to the one the owner is already at, so a view kept alive can tell a new link. */
  visits: number;
  navigate: (view: ViewId, params?: Record<string, string>) => void;
  back: () => void;
  forward: () => void;
  /** Changes a page holds that are not saved yet, by field: leaving the page asks first. */
  unsaved: Record<string, string>;
  setUnsaved: (key: string, message: string | null) => void;
  /** Where the owner was going when the unsaved warning stopped them. */
  pendingLeave: (() => void) | null;
  stayHere: () => void;
  leaveAnyway: () => void;
  sidebarCollapsed: boolean;
  /** The element the inspector's content is drawn into (set by the shell). */
  inspectorNode: HTMLElement | null;
  setInspectorNode: (node: HTMLElement | null) => void;
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
  visits: 0,
  unsaved: {},
  pendingLeave: null,
  setUnsaved: (key, message) =>
    set((s) => {
      const next = { ...s.unsaved };
      if (message === null) delete next[key];
      else next[key] = message;
      return { unsaved: next };
    }),
  stayHere: () => set({ pendingLeave: null }),
  leaveAnyway: () => {
    const go = get().pendingLeave;
    set({ pendingLeave: null, unsaved: {} });
    go?.();
  },
  navigate: (view, params = {}) => {
    // Unsaved changes on this page: ask before going to another one.
    if (view !== get().view && Object.keys(get().unsaved).length > 0) {
      set({ pendingLeave: () => get().navigate(view, params) });
      return;
    }
    const next: Place = { view, params };
    const { history, at } = get();
    const here = history[at];
    const visits = get().visits + 1;
    if (here && samePlace(here, next)) return set({ view, params, visits });
    // Going somewhere new drops whatever was ahead, like a browser's history, then keeps the last 100.
    const kept = [...history.slice(0, at + 1), next].slice(-MAX_HISTORY);
    set({ view, params, history: kept, at: kept.length - 1, visits });
  },
  back: () => {
    const { history, at } = get();
    const to = history[at - 1];
    if (to && to.view !== get().view && Object.keys(get().unsaved).length > 0) {
      set({ pendingLeave: () => get().back() });
      return;
    }
    if (to) set({ view: to.view, params: to.params, at: at - 1, visits: get().visits + 1 });
  },
  forward: () => {
    const { history, at } = get();
    const to = history[at + 1];
    if (to && to.view !== get().view && Object.keys(get().unsaved).length > 0) {
      set({ pendingLeave: () => get().forward() });
      return;
    }
    if (to) set({ view: to.view, params: to.params, at: at + 1, visits: get().visits + 1 });
  },
  sidebarCollapsed: false,
  inspectorNode: null,
  setInspectorNode: (inspectorNode) => set({ inspectorNode }),
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
