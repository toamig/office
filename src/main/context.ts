import { mkdirSync } from "node:fs";
import type { SyncReport, WorkspaceView } from "../shared/models";
import type { MachineSettings } from "../shared/types";
import { Bus } from "./core/bus";
import { openDb, type Db } from "./core/db";
import { IpcRegistry } from "./core/ipc";
import { Notifier } from "./core/notifier";
import { dataDir, dbPath } from "./core/paths";
import { isConfigured, loadSettings, updateSettings } from "./core/settings";
import { WorkspaceStore } from "./core/workspace";
import { ProjectService } from "./modules/git/service";
import { syncAll } from "./modules/git/syncall";
import { notifyFromSyncReport, notifyFromWarning, WaitingWatcher } from "./modules/notify/sources";
import { VaultOps } from "./modules/vault/ops";
import { VaultService } from "./modules/vault/service";
import { VaultWriter } from "./modules/vault/writer";

/** Everything the main process shares: settings, workspace, database, bus and the IPC registry. */
export interface AppContext {
  settings: () => MachineSettings;
  patchSettings: (patch: Partial<MachineSettings>) => MachineSettings;
  store: WorkspaceStore;
  db: Db;
  bus: Bus;
  ipc: IpcRegistry;
  notifier: Notifier;
  projects: ProjectService;
  vault: VaultService;
  ops: VaultOps;
  /** Warnings shown in the health strip (failed pushes, validate errors). */
  warnings: Array<{ at: string; message: string }>;
  /** Sync all repos and raise notifications for what needs the owner. */
  sync: () => Promise<SyncReport>;
  /** Opens the workspace, starts watchers and timers. Call after settings change too. */
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function createContext(checkResponses: boolean): Promise<AppContext> {
  mkdirSync(dataDir(), { recursive: true });
  let current = loadSettings();
  const bus = new Bus();
  const db = openDb(dbPath());
  const store = new WorkspaceStore();
  store.subscribe((state) => bus.emit("workspace.changed", { error: state.error }));

  const notifier = new Notifier({
    db,
    bus,
    workspace: () => store.state.workspace,
    quietHours: () => current.quietHours,
  });
  const vault = new VaultService({
    bus,
    workspace: () => store.state.workspace,
    workspaceRoot: () => current.workspaceRoot,
  });
  const warnings: AppContext["warnings"] = [];
  const writer = new VaultWriter({
    hubRoot: () =>
      store.state.workspace?.vault.kind === "brain-hub" ? current.workspaceRoot : null,
    onWarning: (warning) => {
      warnings.unshift({ at: new Date().toISOString(), message: warning.message });
      warnings.length = Math.min(warnings.length, 20);
      notifyFromWarning(notifier, warning);
    },
  });
  const ops = new VaultOps({ vault, writer, workspace: () => store.state.workspace });
  const projects = new ProjectService({
    bus,
    projects: () => store.state.workspace?.projects ?? [],
    projectsRoot: () => current.projectsRoot,
    waiting: (id) => vault.waitingCount(id),
  });
  const waiting = new WaitingWatcher(vault, notifier, () => store.state.workspace?.projects ?? []);
  bus.on("vault.changed", () => waiting.check());
  bus.on("workspace.changed", () => {
    void vault.watch();
    projects.startAuto();
  });

  const sync = (): Promise<SyncReport> =>
    syncAll({
      workspace: () => store.state.workspace,
      projectsRoot: () => current.projectsRoot,
      workspaceRoot: () => current.workspaceRoot,
      onRepoDone: (id) => void projects.refresh(id),
      onReport: (report) => notifyFromSyncReport(notifier, report),
    });

  const stop = async (): Promise<void> => {
    projects.stopAuto();
    await vault.unwatch();
    await store.close();
  };
  const start = async (): Promise<void> => {
    await stop();
    if (!isConfigured(current)) return;
    await store.open(current.workspaceRoot, current.workspaceConfigPath);
    waiting.prime();
    await vault.watch();
    projects.startAuto();
    void projects.refreshAll();
  };

  return {
    settings: () => current,
    patchSettings: (patch) => (current = updateSettings(patch)),
    store,
    db,
    bus,
    ipc: new IpcRegistry(checkResponses),
    notifier,
    projects,
    vault,
    ops,
    warnings,
    sync,
    start,
    stop,
  };
}

export function workspaceView(ctx: AppContext): WorkspaceView {
  const s = ctx.settings();
  const state = ctx.store.state;
  return {
    configured: isConfigured(s),
    workspaceRoot: s.workspaceRoot,
    workspaceConfigPath: s.workspaceConfigPath,
    projectsRoot: s.projectsRoot,
    editorCommand: s.editorCommand,
    workspace: state.workspace,
    error: state.error,
  };
}
