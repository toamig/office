import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/models";
import { office } from "../../lib/ipc";
import { Button, Card, StatusBadge, notifyError } from "../../ui";

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

  useEffect(() => {
    void office.invoke("app.update.status").then(setStatus);
    return office.on("app.update", (e) => setStatus(e.payload as UpdateStatus));
  }, []);

  const check = (): void => {
    office
      .invoke("app.update.check")
      .then(setStatus, (err: unknown) => notifyError(err, "The update check failed", "update"));
  };

  return (
    <Card title="About Office" testId="panel-about">
      <div data-testid="about">
        {status && (
          <div className="grid gap-3">
            <dl className="ui-dl">
              <dt>Version</dt>
              <dd className="num">{status.version}</dd>
              <dt>Updates</dt>
              <dd className="ui-badges">
                <StatusBadge
                  status={
                    status.state === "error"
                      ? "failed"
                      : status.state === "downloaded" || status.state === "up-to-date"
                        ? "done"
                        : status.state === "downloading" || status.state === "checking"
                          ? "running"
                          : "info"
                  }
                  label={label[status.state]}
                />
                {status.newVersion && (
                  <StatusBadge status="info" label={`New version ${status.newVersion}`} />
                )}
              </dd>
            </dl>
            {status.detail && <div className="ui-muted">{status.detail}</div>}
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
    </Card>
  );
}
