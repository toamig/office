import { useState } from "react";
import { Button, Chip, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { useEscape } from "../../lib/escape";

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
    "Adds one entry per event (SessionStart, UserPromptSubmit, Notification, Stop, SessionEnd) to your Claude Code settings, after any hooks you already have. Uninstalling removes only those entries.",
  codex:
    "Codex runs one notify command. Office wraps the one you have, so it keeps running exactly as before. Uninstalling puts the original command back.",
};

/** Consent screens for the two files Office edits: you see the exact change before anything is written. */
export function HooksPanel({ title = "Agent notifications" }: { title?: string }) {
  const status = useQuery("hooks.status");
  const [pending, setPending] = useState<Pending | null>(null);
  useEscape(() => setPending(null), pending !== null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = async (target: Target, action: Action): Promise<void> => {
    setError(null);
    setMessage(null);
    try {
      const preview = await office.invoke("hooks.preview", { target, action });
      setPending({ target, action, ...preview });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const confirm = async (): Promise<void> => {
    if (!pending) return;
    try {
      const result = await office.invoke("hooks.apply", {
        target: pending.target,
        action: pending.action,
      });
      setMessage(result.backup ? `Done. Backup written to ${result.backup}` : "Done.");
      setPending(null);
      status.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Panel title={title}>
      <p className="mt-0" style={{ color: "var(--muted)" }}>
        Office learns that an agent needs you through hooks in each tool. Nothing is changed until
        you confirm the exact edit below.
      </p>
      {error && <ErrorBanner message={error} />}
      {message && (
        <div className="mb-2" data-testid="hooks-message">
          <Chip tone="good">{message}</Chip>
        </div>
      )}
      <div data-testid="hooks-rows">
        {(["claude", "codex"] as const).map((target) => {
          const s = status.data?.[target];
          return (
            <div
              key={target}
              className="flex items-start gap-3 border-b py-2"
              style={{ borderColor: "var(--line)" }}
              data-testid={`hooks-${target}`}
            >
              <div className="flex-1">
                <div className="font-medium">{labels[target]}</div>
                <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {explain[target]}
                </div>
                <div className="break-all text-[12px]" style={{ color: "var(--muted)" }}>
                  {s?.path}
                </div>
              </div>
              {s?.installed ? <Chip tone="good">installed</Chip> : <Chip>not installed</Chip>}
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
        <div className="dialog-backdrop" data-testid="hooks-consent">
          <div
            className="flex max-h-[80vh] w-[760px] flex-col rounded border"
            style={{ background: "var(--panel)", borderColor: "var(--line)" }}
          >
            <header className="border-b px-4 py-2.5" style={{ borderColor: "var(--line)" }}>
              <h2 className="m-0 text-sm font-semibold">
                {pending.action === "install" ? "Install" : "Uninstall"}: {labels[pending.target]}
              </h2>
              <div className="break-all text-[12px]" style={{ color: "var(--muted)" }}>
                {pending.path}
              </div>
            </header>
            <div className="flex-1 overflow-auto p-4">
              {pending.action === "install" && (
                <p className="mt-0">
                  A timestamped backup of the file is written next to it before the change.
                </p>
              )}
              {pending.changed ? (
                <pre className="m-0 whitespace-pre-wrap text-[12px]" data-testid="hooks-diff">
                  {pending.diff}
                </pre>
              ) : (
                <p>Nothing would change.</p>
              )}
            </div>
            <footer
              className="flex justify-end gap-2 border-t px-4 py-2.5"
              style={{ borderColor: "var(--line)" }}
            >
              <Button onClick={() => setPending(null)} data-testid="hooks-cancel">
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void confirm()} data-testid="hooks-confirm">
                {pending.action === "install" ? "Make this change" : "Remove it"}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </Panel>
  );
}
