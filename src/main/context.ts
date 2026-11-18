import { mkdirSync } from "node:fs";
import type { WorkspaceView } from "../shared/models";
import type { MachineSettings } from "../shared/types";
import { Bus } from "./core/bus";
import { openDb, type Db } from "./core/db";
import { IpcRegistry } from "./core/ipc";
import { dataDir, dbPath } from "./core/paths";
import { isConfigured, loadSettings, updateSettings } from "./core/settings";
import { WorkspaceStore } from "./core/workspace";
import { ProjectService } from "./modules/git/service";

/** Everything the main process shares: settings, workspace, database, bus and the IPC registry. */
export interface AppContext {
  settings: () => MachineSettings;
  patchSettings: (patch: Partial<MachineSettings>) => MachineSettings;
  store: WorkspaceStore;
  db: Db;
  bus: Bus;
  ipc: IpcRegistry;
  projects: ProjectService;
}

export async function createContext(checkResponses: boolean): Promise<AppContext> {
  mkdirSync(dataDir(), { recursive: true });
  let current = loadSettings();
  const bus = new Bus();
  const store = new WorkspaceStore();
  store.subscribe((state) => bus.emit("workspace.changed", { error: state.error }));
  if (isConfigured(current)) await store.open(current.workspaceRoot, current.workspaceConfigPath);
  const projects = new ProjectService({
    bus,
    projects: () => store.state.workspace?.projects ?? [],
    projectsRoot: () => current.projectsRoot,
  });
  return {
    settings: () => current,
    patchSettings: (patch) => (current = updateSettings(patch)),
    store,
    db: openDb(dbPath()),
    bus,
    ipc: new IpcRegistry(checkResponses),
    projects,
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
