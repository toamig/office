import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionRow, SpawnInput, SpawnReport, SpawnStep } from "../../../shared/models";
import type { Bus } from "../../core/bus";
import { IpcFailure } from "../../core/ipc";
import type { SessionService } from "../sessions/service";
import { createNotesRepo, planSpawn, runSpawn, type SpawnDeps } from "./spawn";

export const EXPLORE_ROLE = "explore";

export interface ExploreDeps {
  sessions: SessionService;
  bus: Bus;
  exploreDir: string;
  workspaceRoot: () => string;
  spawn: Omit<SpawnDeps, "providerOf" | "onProgress">;
}

/** Explore: a general chat that can read the brain, and the wizard that turns it into a project. */
export class ExploreService {
  constructor(private readonly deps: ExploreDeps) {}

  /** An interactive session in its own folder under the app data, with the vault added for reading. */
  start(providerId = "claude-code", title?: string): SessionRow {
    const id = randomUUID();
    const dir = join(this.deps.exploreDir, id);
    mkdirSync(dir, { recursive: true });
    const root = this.deps.workspaceRoot();
    return this.deps.sessions.start(
      {
        providerId,
        cwd: dir,
        title: title?.trim() || `Exploration ${new Date().toLocaleString()}`,
      },
      { ...(root ? { addDirs: [root] } : {}), roleLabel: EXPLORE_ROLE },
    );
  }

  list(): SessionRow[] {
    return this.deps.sessions
      .list({ includeArchived: false })
      .filter((s) => s.role === EXPLORE_ROLE);
  }

  private spawnDeps(): SpawnDeps {
    return {
      ...this.deps.spawn,
      providerOf: (sessionId) =>
        sessionId ? (this.deps.sessions.find(sessionId)?.provider ?? "claude-code") : "claude-code",
      onProgress: (steps) => this.deps.bus.emit("run.progress", { kind: "spawn", steps }),
    };
  }

  /** The checklist, shown before anything runs. */
  plan(input: SpawnInput): SpawnStep[] {
    return planSpawn(this.spawnDeps(), input);
  }

  /** A notes repo for an existing project, registered in the brain hub (adding projects). */
  notesRepo(name: string, domain: SpawnInput["domain"], stack: string): Promise<string> {
    return createNotesRepo(this.spawnDeps(), name, domain, stack);
  }

  async spawn(input: SpawnInput): Promise<SpawnReport> {
    if (input.visibility === "public" && !input.publicConfirmed) {
      throw new IpcFailure(
        "needs-confirm",
        "Creating a public repo needs its own explicit confirmation",
      );
    }
    return runSpawn(this.spawnDeps(), input);
  }
}
