import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { UpdateService, type UpdaterLike } from "../../src/main/core/update";

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  installed = 0;
  fail = false;
  async checkForUpdates(): Promise<void> {
    this.checks++;
    if (this.fail) throw new Error("offline");
    this.emit("checking-for-update");
  }
  quitAndInstall(): void {
    this.installed++;
  }
}

describe("UpdateService", () => {
  it("is disabled in development runs: it never checks, and says why", async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService({ updater, version: "0.1.0", enabled: false });
    expect(service.status()).toMatchObject({ enabled: false, state: "disabled", version: "0.1.0" });
    expect((await service.check()).state).toBe("disabled");
    expect(updater.checks).toBe(0);
    expect(updater.autoDownload).toBe(false);
  });

  it("downloads in the background, installs on quit, and follows the updater's events", async () => {
    const updater = new FakeUpdater();
    const seen: string[] = [];
    const service = new UpdateService({
      updater,
      version: "0.1.0",
      enabled: true,
      onChange: (s) => seen.push(s.state),
    });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);

    await service.check();
    expect(updater.checks).toBe(1);
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("download-progress", { percent: 41.6 });
    expect(service.status()).toMatchObject({
      state: "downloading",
      newVersion: "0.2.0",
      detail: "42%",
    });
    service.installNow(); // nothing is downloaded yet
    expect(updater.installed).toBe(0);

    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(service.status()).toMatchObject({
      state: "downloaded",
      detail: "It installs when you quit Office.",
    });
    service.installNow();
    expect(updater.installed).toBe(1);
    expect(seen).toEqual(["checking", "downloading", "downloading", "downloaded"]);
  });

  it("reports no update, and a failed check as an error state", async () => {
    const updater = new FakeUpdater();
    const service = new UpdateService({ updater, version: "0.1.0", enabled: true });
    updater.emit("update-not-available", {});
    expect(service.status().state).toBe("up-to-date");
    updater.fail = true;
    const status = await service.check();
    expect(status).toMatchObject({ state: "error", detail: "offline" });
    updater.emit("error", new Error("signature mismatch"));
    expect(service.status().detail).toBe("signature mismatch");
  });
});
