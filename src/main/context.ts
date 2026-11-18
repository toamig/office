import { mkdirSync } from "node:fs";
import type { WorkspaceView } from "../shared/models";
import type { MachineSettings } from "../shared/types";
import { Bus } from "./core/bus";
import { openDb, type Db } from "./core/db";
import { IpcRegistry } from "./core/ipc";
import { dataDir, dbPath } from "./core/paths";
import { isConfigured, loadSettings, updateSettings } from "./core/settings";
import { WorkspaceStore } from "./core/workspace";
import type { SyncReport } from "../shared/models";
import { ProjectService } from "./modules/git/service";
import { syncAll } from "./modules/git/syncall";
import { VaultOps } from "./modules/vault/ops";
import { VaultService } from "./modules/vault/service";
import { VaultWriter, type WriterWarning } from "./modules/vault/writer";

/** Everything the main process shares: settings, workspace, database, bus and the IPC registry. */
export interface AppContext {
  settings: () => MachineSettings;
  patchSettings: (patch: Partial<MachineSettings>) => MachineSettings;
  store: WorkspaceStore;
  db: Db;
  bus: Bus;
  ipc: IpcRegistry;
  projects: ProjectService;
  vault: VaultService;
  ops: VaultOps;
  /** Warnings shown in the health strip (failed pushes, validate errors). */
  warnings: Array<{ at: string; message: string }>;
  warningHooks: Array<(warning: WriterWarning) => void>;
  /** Sync all repos; the notifier hooks in through reportHooks. */
  sync: () => Promise<SyncReport>;
  reportHooks: Array<(report: SyncReport) => void | Promise<void>>;
}

export async function createContext(checkResponses: boolean): Promise<AppContext> {
  mkdirSync(dataDir(), { recursive: true });
  let current = loadSettings();
  const bus = new Bus();
  const store = new WorkspaceStore();
  store.subscribe((state) => bus.emit("workspace.changed", { error: state.error }));
  if (isConfigured(current)) await store.open(current.workspaceRoot, current.workspaceConfigPath);
  const vault = new VaultService({
    bus,
    workspace: () => store.state.workspace,
    workspaceRoot: () => current.workspaceRoot,
  });
  const warnings: AppContext["warnings"] = [];
  const warningHooks: AppContext["warningHooks"] = [];
  const writer = new VaultWriter({
    hubRoot: () =>
      store.state.workspace?.vault.kind === "brain-hub" ? current.workspaceRoot : null,
    onWarning: (warning) => {
      warnings.unshift({ at: new Date().toISOString(), message: warning.message });
      warnings.length = Math.min(warnings.length, 20);
      for (const hook of warningHooks) hook(warning);
    },
  });
  const ops = new VaultOps({ vault, writer, workspace: () => store.state.workspace });
  const projects = new ProjectService({
    bus,
    projects: () => store.state.workspace?.projects ?? [],
    projectsRoot: () => current.projectsRoot,
    waiting: (id) => vault.waitingCount(id),
  });
  const reportHooks: AppContext["reportHooks"] = [];
  const sync = (): Promise<SyncReport> =>
    syncAll({
      workspace: () => store.state.workspace,
      projectsRoot: () => current.projectsRoot,
      workspaceRoot: () => current.workspaceRoot,
      onRepoDone: (id) => void projects.refresh(id),
      onReport: async (report) => {
        for (const hook of reportHooks) await hook(report);
      },
    });
  return {
    sync,
    reportHooks,
    settings: () => current,
    patchSettings: (patch) => (current = updateSettings(patch)),
    store,
    db: openDb(dbPath()),
    bus,
    ipc: new IpcRegistry(checkResponses),
    projects,
    vault,
    ops,
    warnings,
    warningHooks,
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
