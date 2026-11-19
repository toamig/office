import { useEffect } from "react";
import { RAIL } from "../components/Sidebar";
import { VIEW_LABELS } from "./views";
import { office } from "./ipc";
import { appShortcut } from "./keys";
import { useUi } from "../stores/ui";

export interface Shortcut {
  keys: string;
  label: string;
}

/** Every shortcut Office has, in the order the sheet shows them. Nothing else is bound. */
export const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl+K", label: "Jump to anything" },
  ...RAIL.map((v, i) => ({ keys: `Ctrl+${i + 1}`, label: `Go to ${VIEW_LABELS[v.id]}` })),
  { keys: "Ctrl+B", label: "Show or hide the sidebar" },
  { keys: "Ctrl+Shift+B", label: "Show or hide the details panel" },
  { keys: "Ctrl+Shift+A", label: "Start a session" },
  { keys: "Ctrl+Shift+T", label: "Bring back the panel you closed last" },
  { keys: "Ctrl+Shift+N", label: "Start an incognito chat" },
  { keys: "Ctrl+,", label: "Setup" },
  { keys: "Ctrl+F", label: "Find in the current view" },
  { keys: "Ctrl+Shift+F", label: "Find in a terminal" },
  { keys: "Alt+Left / Alt+Right", label: "Back and forward" },
  { keys: "Ctrl+= / Ctrl+- / Ctrl+0", label: "Zoom the interface, or reset it" },
  { keys: "Ctrl+/", label: "This list" },
  { keys: "Esc", label: "Close the top dialog" },
];

/** Tells the focused view to open its find (a terminal, a chat, a list). */
export const FIND_EVENT = "office-find";

/** Tells the workbench on screen to bring back the panel closed last. */
export const REOPEN_PANEL_EVENT = "office-reopen-panel";

/** The app-wide keys. Ctrl+K lives with the quick switcher; Esc with the dialogs. */
export function useGlobalShortcuts(toggleSidebar: () => void, toggleInspector: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState();
      const inTerminal = Boolean((document.activeElement as Element | null)?.closest?.(".xterm"));
      const action = appShortcut(e, inTerminal);
      if (!action) return;
      e.preventDefault();
      if (action.kind === "back") ui.back();
      else if (action.kind === "forward") ui.forward();
      else if (action.kind === "shortcuts") ui.setShortcutsOpen(!ui.shortcutsOpen);
      else if (action.kind === "setup") ui.navigate("setup");
      else if (action.kind === "sidebar") toggleSidebar();
      else if (action.kind === "inspector") toggleInspector();
      else if (action.kind === "new-agent") ui.navigate("agents", { start: "1" });
      else if (action.kind === "find") window.dispatchEvent(new Event(FIND_EVENT));
      else if (action.kind === "new-incognito") ui.navigate("explore", { incognito: "1" });
      else if (action.kind === "reopen-panel") window.dispatchEvent(new Event(REOPEN_PANEL_EVENT));
      else {
        const target = RAIL[action.index];
        if (target) ui.navigate(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    // The mouse's back and forward buttons arrive as events from the main process.
    const off = office.on("app.history", (e) => {
      if (e.payload === "back") useUi.getState().back();
      if (e.payload === "forward") useUi.getState().forward();
    });
    // Ctrl and the wheel zoom the interface, not the page.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      void office.invoke("settings.get").then((s) => {
        const next = Math.min(150, Math.max(80, s.zoom + (e.deltaY < 0 ? 10 : -10)));
        if (next !== s.zoom) void office.invoke("settings.set", { zoom: next });
      });
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    // Nothing navigates away if a file is dropped, except in a drop zone.
    const guard = (e: DragEvent): void => {
      if ((e.target as Element | null)?.closest?.("[data-dropzone]")) return;
      e.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
      off();
    };
  }, [toggleSidebar, toggleInspector]);
}
