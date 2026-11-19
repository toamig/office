import { useState } from "react";
import { Button, Card, Dialog, StatusBadge, notifyDone, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

type Target = "claude" | "codex";
type Action = "install" | "uninstall";

interface Pending {
  target: Target;
  action: Action;
  path: string;
  diff: string;
  changed: boolean;
}

const labels: Record<Target, string> = { claude: "Claude Code hooks", codex: "Codex notify" };
const explain: Record<Target, string> = {
  claude:
    "Adds one small entry for each session event (a session starts, works, needs you or ends) to your Claude Code settings, after any hooks you already have. Uninstalling removes only those entries.",
  codex:
    "Codex runs one notify command. Office wraps the one you have, so it keeps running exactly as before. Uninstalling puts the original command back.",
};

/** What a change does, in plain words, for the consent dialog. The exact change is behind a toggle. */
function PlainWords({ target, action }: { target: Target; action: Action }) {
  if (action === "uninstall") {
    return (
      <div className="grid gap-2" data-testid="hooks-plain">
        <p className="m-0">
          {target === "claude"
            ? "This removes only the entries Office added to your Claude Code settings. Everything else in the file stays as it is."
            : "This puts your original Codex notify command back, exactly as it was before Office wrapped it."}
        </p>
        <p className="m-0 ui-muted">
          A backup of the file is written first, and you can install again at any time.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-testid="hooks-plain">
      {target === "claude" ? (
        <>
          <p className="m-0">
            <b>What it adds.</b> One small hook for each event, so Office knows when a terminal
            session starts, works, needs you or ends and can tell you.
          </p>
          <p className="m-0">
            <b>What it means.</b> Hooks in your user settings run for every Claude Code session on
            this PC, not only Office's. Each one is a short Node script that exits at once when
            Office is not running, never blocks Claude Code, and gives up after 2 seconds at most.
          </p>
        </>
      ) : (
        <>
          <p className="m-0">
            <b>What it adds.</b> Codex runs one notify command. Office wraps the one you have, so it
            keeps running exactly as before, and Office also learns when a turn ends or Codex needs
            you.
          </p>
          <p className="m-0">
            <b>What it means.</b> The wrapper is a short Node script that exits at once when Office
            is not running, never blocks Codex, and gives up after 2 seconds at most.
          </p>
        </>
      )}
      <p className="m-0">
        <b>Your way out.</b> A timestamped backup of the file is written next to it before the
        change, and Uninstall here removes it again in one click.
      </p>
      <p className="m-0 ui-muted">
        Chat sessions in Office do not need this; it is for sessions you run in a terminal.
      </p>
    </div>
  );
}

/** Consent screens for the two files Office edits: you see the exact change before anything is written. */
export function HooksPanel({ title = "Agent notifications" }: { title?: string }) {
  const status = useQuery("hooks.status");
  const [pending, setPending] = useState<Pending | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const review = async (target: Target, action: Action): Promise<void> => {
    try {
      const preview = await office.invoke("hooks.preview", { target, action });
      setShowDiff(false);
      setPending({ target, action, ...preview });
    } catch (err) {
      notifyError(err, "The hooks were not changed", "hooks");
    }
  };
  const confirm = async (): Promise<void> => {
    if (!pending) return;
    try {
      const result = await office.invoke("hooks.apply", {
        target: pending.target,
        action: pending.action,
      });
      notifyDone(
        pending.action === "install" ? "Hooks installed" : "Hooks removed",
        result.backup ? `A backup was written to ${result.backup}` : undefined,
        "hooks",
      );
      setPending(null);
      status.reload();
    } catch (err) {
      notifyError(err, "The hooks were not changed", "hooks");
    }
  };

  return (
    <Card title={title} testId="panel-hooks">
      <p className="mt-0 ui-muted">
        Office learns that an agent needs you through hooks in each tool. Nothing is changed until
        you confirm the exact edit below.
      </p>
      <div data-testid="hooks-rows">
        {(["claude", "codex"] as const).map((target) => {
          const s = status.data?.[target];
          return (
            <div key={target} className="ui-line" data-testid={`hooks-${target}`}>
              <div className="ui-line-main">
                <div className="font-medium">{labels[target]}</div>
                <div className="text-[length:var(--text-sm)] ui-muted">{explain[target]}</div>
                <div className="break-all text-[length:var(--text-xs)] ui-muted">{s?.path}</div>
              </div>
              {s?.installed ? (
                <StatusBadge status="installed" />
              ) : (
                <StatusBadge status="not-installed" tone="neutral" />
              )}
              {s?.installed ? (
                <Button
                  onClick={() => void review(target, "uninstall")}
                  data-testid={`uninstall-${target}`}
                >
                  Uninstall
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => void review(target, "install")}
                  data-testid={`install-${target}`}
                >
                  Install
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {pending && (
        <Dialog
          title={`${pending.action === "install" ? "Install" : "Uninstall"}: ${labels[pending.target]}`}
          testId="hooks-consent"
          wide
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)} data-testid="hooks-cancel">
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirm()} data-testid="hooks-confirm">
                {pending.action === "install" ? "Make this change" : "Remove it"}
              </Button>
            </>
          }
        >
          <div className="ui-line-sub mb-3 break-all">{pending.path}</div>
          <PlainWords target={pending.target} action={pending.action} />
          {pending.changed ? (
            <div className="mt-3">
              <Button
                variant="ghost"
                onClick={() => setShowDiff((v) => !v)}
                aria-expanded={showDiff}
                data-testid="hooks-diff-toggle"
              >
                {showDiff ? "Hide the exact change" : "Show the exact change"}
              </Button>
              {showDiff && (
                <pre className="ui-codeblock mt-2" data-testid="hooks-diff">
                  {pending.diff}
                </pre>
              )}
            </div>
          ) : (
            <p>Nothing would change.</p>
          )}
        </Dialog>
      )}
    </Card>
  );
}
