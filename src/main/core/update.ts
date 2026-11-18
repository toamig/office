import type { UpdateStatus } from "../../shared/models";

const versionOf = (info: unknown): string | null =>
  info && typeof info === "object" && typeof (info as { version?: unknown }).version === "string"
    ? (info as { version: string }).version
    : null;

const percentOf = (progress: unknown): number =>
  progress &&
  typeof progress === "object" &&
  typeof (progress as { percent?: unknown }).percent === "number"
    ? (progress as { percent: number }).percent
    : 0;

/** The part of electron-updater's autoUpdater that Office uses, so tests can fake it. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateServiceDeps {
  updater: UpdaterLike;
  version: string;
  /** Releases are only checked for when the app is installed from one. */
  enabled: boolean;
  disabledReason?: string;
  onChange?: (status: UpdateStatus) => void;
}

/**
 * Checks GitHub Releases through electron-updater when the app starts, downloads in the background and
 * installs when the app quits (plan M5.6). Publishing a release is the owner's `npm run release`.
 */
export class UpdateService {
  private current: UpdateStatus;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.current = {
      version: deps.version,
      enabled: deps.enabled,
      state: deps.enabled ? "idle" : "disabled",
      newVersion: null,
      detail: deps.enabled ? null : (deps.disabledReason ?? "Updates are off in development runs"),
    };
    if (!deps.enabled) return;
    const { updater } = deps;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on("checking-for-update", () => this.set({ state: "checking", detail: null }));
    updater.on("update-available", (info) =>
      this.set({ state: "downloading", newVersion: versionOf(info), detail: null }),
    );
    updater.on("update-not-available", () =>
      this.set({ state: "up-to-date", newVersion: null, detail: null }),
    );
    updater.on("download-progress", (progress) =>
      this.set({ state: "downloading", detail: `${Math.round(percentOf(progress))}%` }),
    );
    updater.on("update-downloaded", (info) =>
      this.set({
        state: "downloaded",
        newVersion: versionOf(info) ?? this.current.newVersion,
        detail: "It installs when you quit Office.",
      }),
    );
    updater.on("error", (err) =>
      this.set({ state: "error", detail: err instanceof Error ? err.message : String(err) }),
    );
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.current = { ...this.current, ...patch };
    this.deps.onChange?.(this.current);
  }

  status(): UpdateStatus {
    return this.current;
  }

  /** Looks for a newer release now. Failures show up as the "error" state, never as a crash. */
  async check(): Promise<UpdateStatus> {
    if (!this.deps.enabled) return this.current;
    try {
      await this.deps.updater.checkForUpdates();
    } catch (err) {
      this.set({ state: "error", detail: (err as Error).message });
    }
    return this.current;
  }

  /** Quits and installs a downloaded update right away. */
  installNow(): void {
    if (this.current.state === "downloaded") this.deps.updater.quitAndInstall(false, true);
  }
}
