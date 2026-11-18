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

interface UiState {
  view: ViewId;
  params: Record<string, string>;
  navigate: (view: ViewId, params?: Record<string, string>) => void;
  syncing: boolean;
  syncReport: SyncReport | null;
  setSyncing: (syncing: boolean) => void;
  setSyncReport: (report: SyncReport | null) => void;
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  view: "home",
  params: {},
  navigate: (view, params = {}) => set({ view, params }),
  syncing: false,
  syncReport: null,
  setSyncing: (syncing) => set({ syncing }),
  setSyncReport: (syncReport) => set({ syncReport }),
  switcherOpen: false,
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
}));
