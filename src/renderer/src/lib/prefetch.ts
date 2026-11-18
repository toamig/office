import type { ViewId } from "../stores/ui";
import { prefetch } from "./query";

/**
 * The reads each view opens with, so they can be started before the click: at start for the views a day begins
 * with, and when the pointer reaches a sidebar item for that item's view. Each entry has to match the channel
 * and payload the view asks for, or the view would find nothing waiting.
 */
const READS: Partial<Record<ViewId, Array<() => void>>> = {
  home: [
    () => prefetch("vault.waiting"),
    () => prefetch("brief.latest"),
    () => prefetch("projects.list"),
    () => prefetch("vault.health"),
    () => prefetch("sessions.list", {}),
    () => prefetch("notifications.list", { unread: true, limit: 200 }),
    () => prefetch("tasks.list", {}),
    () => prefetch("automations.list"),
    () => prefetch("permissions.list"),
  ],
  projects: [() => prefetch("projects.list")],
  agents: [() => prefetch("sessions.list", {}), () => prefetch("projects.list")],
  inbox: [
    () => prefetch("notifications.list", { limit: 1000 }),
    () => prefetch("projects.list"),
    () => prefetch("permissions.list"),
  ],
  git: [() => prefetch("projects.list"), () => prefetch("vault.health")],
  board: [
    () => prefetch("tasks.list", {}),
    () => prefetch("projects.list"),
    () => prefetch("workspace.get"),
  ],
  brain: [
    () => prefetch("projects.list"),
    () => prefetch("vault.health"),
    () => prefetch("vault.audit"),
  ],
  explore: [() => prefetch("explore.list"), () => prefetch("providers.list")],
  setup: [
    () => prefetch("workspace.get"),
    () => prefetch("setup.detectTools"),
    () => prefetch("hooks.status"),
    () => prefetch("settings.get"),
    () => prefetch("projects.list"),
    () => prefetch("automations.list"),
    () => prefetch("modules.list"),
    () => prefetch("setup.inventory", {}),
  ],
};

/** Starts the reads of one view. Cheap to call again: a key that has fresh data is not read twice. */
export function prefetchView(view: ViewId): void {
  for (const read of READS[view] ?? []) read();
}

/** At start: what Home, Projects, Agents and Inbox need. */
export function prefetchStart(): void {
  for (const view of ["home", "projects", "agents", "inbox"] as const) prefetchView(view);
}
