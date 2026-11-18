import type { HealthView } from "../../../shared/models";

export interface HealthDeps {
  root: () => string;
  /** The kind of vault the workspace uses; only a brain hub has anything to validate. */
  kind: () => string | undefined;
  warnings: () => HealthView["warnings"];
  validate: (root: string) => Promise<HealthView["validate"]>;
  repos: (root: string) => Promise<HealthView["repos"]>;
  /** Called after each check, so the screens can read the new result. */
  onChange: () => void;
  now?: () => Date;
}

const NOT_RUN: HealthView["validate"] = {
  ran: false,
  ok: true,
  errors: [],
  warnings: 0,
  summary: null,
};

/**
 * The brain's health: validation plus the hub's git status. Both take seconds, so nothing asks for them on
 * the request path. A background job refreshes them when the brain changes (debounced), after Sync all and
 * every 15 minutes, and `view()` only returns the last result with its time.
 */
export class HealthService {
  private validate: HealthView["validate"] = NOT_RUN;
  private repos: HealthView["repos"] = [];
  private checkedAt: string | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private debounce: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: HealthDeps) {}

  view(): HealthView {
    return {
      validate: this.validate,
      repos: this.repos,
      warnings: this.deps.warnings(),
      checkedAt: this.checkedAt,
    };
  }

  /** Checks now. A check under way is not repeated; a request that arrives during one runs once more after it. */
  refresh(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.inflight = this.check()
      .catch(() => undefined)
      .finally(() => {
        this.inflight = null;
        if (this.again) {
          this.again = false;
          void this.refresh();
        }
      });
    return this.inflight;
  }

  private async check(): Promise<void> {
    const root = this.deps.root();
    if (!root || this.deps.kind() !== "brain-hub") {
      this.validate = NOT_RUN;
      this.repos = [];
    } else {
      const [validate, repos] = await Promise.all([
        this.deps.validate(root),
        this.deps.repos(root),
      ]);
      this.validate = validate;
      this.repos = repos;
    }
    this.checkedAt = (this.deps.now?.() ?? new Date()).toISOString();
    this.deps.onChange();
  }

  /** The brain changed: check once it has been quiet for a while, however many files changed. */
  schedule(delayMs = 30_000): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(), delayMs);
    this.debounce.unref?.();
  }

  start(everyMs = 900_000): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearTimeout(this.debounce);
    clearInterval(this.timer);
  }
}
