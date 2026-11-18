import type { WriteResult } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { IpcFailure } from "../../core/ipc";
import type { VaultService } from "./service";
import { VaultWriteError, type VaultWriter } from "./writer";

export interface VaultOpsDeps {
  vault: VaultService;
  writer: VaultWriter;
  workspace: () => Workspace | null;
}

const clip = (text: string, n = 60): string =>
  text.length > n ? `${text.slice(0, n - 1)}...` : text;

/** The user-facing vault writes: tick an item done, add one, file a quick note. */
export class VaultOps {
  constructor(private readonly deps: VaultOpsDeps) {}

  private target(projectId: string): { file: string; name: string; heading: string } {
    const ws = this.deps.workspace();
    const project = ws?.projects.find((p) => p.id === projectId);
    const file = this.deps.vault.openItemsFile(projectId);
    if (!ws || !project || !file) {
      throw new IpcFailure("no-vault", "This project has no notes folder in the vault");
    }
    return { file, name: project.name, heading: ws.vault.waitingHeading };
  }

  private async guard(work: Promise<WriteResult>): Promise<WriteResult> {
    try {
      const result = await work;
      this.deps.vault.invalidate();
      return result;
    } catch (err) {
      if (err instanceof VaultWriteError) throw new IpcFailure(`vault.${err.code}`, err.message);
      throw err;
    }
  }

  /** Removes one "Waiting on you" line and commits it. Git keeps the history. */
  tickWaiting(projectId: string, raw: string): Promise<WriteResult> {
    const { file, name, heading } = this.target(projectId);
    const text = /^- \[ \] \d{4}-\d{2}-\d{2} (.*)$/.exec(raw)?.[1] ?? raw;
    return this.guard(
      this.deps.writer.removeWaiting(file, raw, heading, `${name}: done: ${clip(text)}`),
    );
  }

  /** Appends a dated line to "Waiting on you". */
  addWaiting(projectId: string, text: string, source?: string): Promise<WriteResult> {
    const { file, name, heading } = this.target(projectId);
    return this.guard(
      this.deps.writer.addWaiting(file, heading, text, source, `${name}: waiting: ${clip(text)}`),
    );
  }

  /** A quick note is raw material: a dated bullet under "Notes to file" (plan section 8). */
  addNote(projectId: string, text: string): Promise<WriteResult> {
    const { file, name } = this.target(projectId);
    const line = `- ${this.deps.writer.today()} ${text.replace(/\s+/g, " ").trim()}`;
    return this.guard(
      this.deps.writer.addToSection(file, "Notes to file", line, `${name}: quick note`),
    );
  }

  /** Adds a todo bullet under a named section (used by end-of-session capture). */
  addTodo(projectId: string, text: string, heading = "Todo"): Promise<WriteResult> {
    const { file, name } = this.target(projectId);
    const line = `- ${text.replace(/\s+/g, " ").trim()}`;
    return this.guard(
      this.deps.writer.addToSection(file, heading, line, `${name}: todo: ${clip(text)}`),
    );
  }

  today(): string {
    return this.deps.writer.today();
  }
}
