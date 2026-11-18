import type { SyncReport } from "../../../shared/models";
import type { Notifier } from "../../core/notifier";
import type { VaultService } from "../vault/service";
import type { WriterWarning } from "../vault/writer";

const linkFor = (id: string): { view: string; params?: Record<string, string> } =>
  id.startsWith("hub:") ? { view: "git" } : { view: "project", params: { id } };
const projectOf = (id: string): string | null => (id.startsWith("hub:") ? null : id);

/** Sync results that need the owner: conflicts, failed pushes, repos that could not be brought up to date. */
export function notifyFromSyncReport(notifier: Notifier, report: SyncReport): void {
  for (const repo of report.repos) {
    if (repo.action === "conflict") {
      notifier.notify({
        kind: "git.conflict",
        projectId: projectOf(repo.id),
        title: `Sync conflict in ${repo.name}`,
        body: repo.reason ?? "Local and remote changes conflict; nothing was merged.",
        link: linkFor(repo.id),
      });
    } else if (repo.action === "failed" && repo.pushFailed) {
      notifier.notify({
        kind: "git.push-failed",
        projectId: projectOf(repo.id),
        title: `Push failed in ${repo.name}`,
        body: repo.reason ?? null,
        link: linkFor(repo.id),
      });
    } else if (repo.action === "skipped" && /overlap incoming/.test(repo.reason ?? "")) {
      notifier.notify({
        kind: "git.behind",
        projectId: projectOf(repo.id),
        title: `${repo.name} is behind and has local edits in the way`,
        body: repo.reason ?? null,
        link: linkFor(repo.id),
      });
    }
  }
}

/** Failed vault writes and brain validate errors. */
export function notifyFromWarning(notifier: Notifier, warning: WriterWarning): void {
  notifier.notify({
    kind: warning.kind === "push-failed" ? "git.push-failed" : "vault.write-failed",
    title:
      warning.kind === "push-failed"
        ? "A brain commit was not pushed"
        : "A brain write needs attention",
    body: warning.message,
    link: { view: "home" },
  });
}

/** Raises vault.waiting-new when a "Waiting on you" line appears that was not there before. */
export class WaitingWatcher {
  private seen = new Map<string, Set<string>>();
  private primed = false;

  constructor(
    private readonly vault: VaultService,
    private readonly notifier: Notifier,
    private readonly projects: () => Array<{ id: string; name: string; archived: boolean }>,
  ) {}

  /** Records the current items without notifying (call once at startup). */
  prime(): void {
    this.seen = this.snapshot();
    this.primed = true;
  }

  private snapshot(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const p of this.projects()) {
      if (p.archived) continue;
      out.set(p.id, new Set(this.vault.read(p.id).waiting.map((w) => w.raw)));
    }
    return out;
  }

  check(): void {
    this.vault.invalidate();
    const now = this.snapshot();
    if (this.primed) {
      for (const p of this.projects()) {
        const before = this.seen.get(p.id) ?? new Set<string>();
        for (const w of this.vault.read(p.id).waiting) {
          if (before.has(w.raw) || p.archived) continue;
          this.notifier.notify({
            kind: "vault.waiting-new",
            projectId: p.id,
            title: `New for you in ${p.name}`,
            body: w.text,
            link: { view: "project", params: { id: p.id } },
          });
        }
      }
    }
    this.seen = now;
    this.primed = true;
  }
}
