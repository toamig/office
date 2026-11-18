import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { TerminalView } from "../agents/TerminalView";

/** Which of the tools a first run cannot do without, as a short note next to each row. */
const NEEDED: Record<string, string> = {
  git: "Required",
  "claude-code": "One of Claude Code or Codex is required",
  codex: "One of Claude Code or Codex is required",
};

/**
 * Which command-line tools are installed and logged in, with a fix for each problem. Logging in and installing
 * run in a terminal shown right here, so the owner never has to find it; when it ends the tools are checked
 * again. Used by the welcome flow and by Setup.
 */
export function ToolsStep() {
  const tools = useQuery("setup.detectTools", undefined, ["setup.changed"]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [terminal, setTerminal] = useState<{ id: string; title: string } | null>(null);

  const recheck = async (): Promise<void> => {
    setChecking(true);
    try {
      await office.invoke("setup.recheckTools");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const open = async (channel: "setup.loginSession" | "setup.installSession", id: string) => {
    setError(null);
    try {
      const session = await office.invoke(channel, { id });
      setTerminal({ id: session.id, title: session.title ?? "Terminal" });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const close = (): void => {
    if (terminal) void office.invoke("sessions.archive", { id: terminal.id }).catch(() => undefined);
    setTerminal(null);
  };

  // When the login or install ends, look at the tools again.
  useEffect(() => {
    if (!terminal) return;
    return office.on("session.status", (e) => {
      const payload = e.payload as { id?: string; status?: string };
      if (payload.id === terminal.id && (payload.status === "exited" || payload.status === "failed"))
        void recheck();
    });
  }, [terminal]);

  return (
    <div data-testid="tools-step">
      <div className="mb-2 flex items-center">
        <span className="flex-1" style={{ color: "var(--muted)" }}>
          Office drives your own command-line tools with your own logins. It never sees a password.
        </span>
        <Button
          variant="ghost"
          onClick={() => void recheck()}
          disabled={checking}
          aria-label="Check again"
          data-testid="tools-check"
        >
          <RefreshCw size={13} /> {checking ? "Checking..." : "Check again"}
        </Button>
      </div>
      {tools.error && <ErrorBanner message={tools.error} />}
      {error && <ErrorBanner message={error} />}
      {tools.loading && <EmptyState>Checking tools...</EmptyState>}
      <div data-testid="tools">
        {tools.data?.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-3 border-b py-2"
            style={{ borderColor: "var(--line)" }}
            data-testid="tool-row"
          >
            <span className="w-32 font-medium">{t.label}</span>
            {t.installed ? (
              <Chip tone="good">installed {t.version ?? ""}</Chip>
            ) : (
              <Chip tone="bad">missing</Chip>
            )}
            {t.loggedIn === true && <Chip tone="good">logged in</Chip>}
            {t.loggedIn === false && <Chip tone="warn">not logged in</Chip>}
            <div className="flex-1 text-[12.5px]">
              {NEEDED[t.id] && (
                <div style={{ color: "var(--muted)" }} data-testid="tool-needed">
                  {NEEDED[t.id]}
                </div>
              )}
              {t.problem && <div style={{ color: "var(--warn)" }}>{t.problem}</div>}
              {t.fix && <div style={{ color: "var(--muted)" }}>Fix: {t.fix}</div>}
            </div>
            {t.installed && t.loggedIn === false && (
              <Button
                onClick={() => void open("setup.loginSession", t.id)}
                data-testid="tool-login"
              >
                Log in
              </Button>
            )}
            {!t.installed && t.id === "codex" && (
              <Button
                onClick={() => void open("setup.installSession", t.id)}
                data-testid="tool-install"
              >
                Install (npm i -g @openai/codex)
              </Button>
            )}
          </div>
        ))}
      </div>
      {terminal && (
        <div className="mt-3 rounded border" style={{ borderColor: "var(--line)" }} data-testid="tool-terminal">
          <div
            className="flex items-center border-b px-2 py-1"
            style={{ borderColor: "var(--line)" }}
          >
            <span className="flex-1 font-medium">{terminal.title}</span>
            <Button variant="ghost" onClick={close} aria-label="Close terminal">
              <X size={14} />
            </Button>
          </div>
          <div style={{ height: 260 }}>
            <TerminalView id={terminal.id} />
          </div>
        </div>
      )}
    </div>
  );
}
