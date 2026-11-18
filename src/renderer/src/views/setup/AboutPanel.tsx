import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/models";
import { Button, Chip, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";

const label: Record<UpdateStatus["state"], string> = {
  disabled: "Updates are off",
  idle: "Not checked yet",
  checking: "Checking for updates...",
  available: "An update was found",
  downloading: "Downloading an update",
  downloaded: "Update ready",
  "up-to-date": "You have the latest version",
  error: "The update check failed",
};

/** The version, and the state of automatic updates from GitHub Releases. */
export function AboutPanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void office.invoke("app.update.status").then(setStatus);
    return office.on("app.update", (e) => setStatus(e.payload as UpdateStatus));
  }, []);

  const check = (): void => {
    setError(null);
    office.invoke("app.update.check").then(setStatus, (err: Error) => setError(err.message));
  };

  return (
    <Panel title="About Office">
      <div data-testid="about">
        {error && <ErrorBanner message={error} />}
        {status && (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <span>Version</span>
              <Chip>{status.version}</Chip>
              <Chip
                tone={
                  status.state === "error"
                    ? "bad"
                    : status.state === "downloaded"
                      ? "good"
                      : "neutral"
                }
              >
                {label[status.state]}
              </Chip>
              {status.newVersion && <Chip tone="good">new: {status.newVersion}</Chip>}
            </div>
            {status.detail && (
              <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                {status.detail}
              </div>
            )}
            <div className="flex gap-2">
              <Button disabled={!status.enabled} onClick={check} data-testid="update-check">
                Check for updates
              </Button>
              {status.state === "downloaded" && (
                <Button
                  variant="primary"
                  onClick={() => void office.invoke("app.update.install")}
                  data-testid="update-install"
                >
                  Restart and install
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
