import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ToolStatus } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { ToolRunDialog, type ToolRun } from "./ToolRunDialog";

/** Which of the tools a first run cannot do without, as a short note next to each row. */
const NEEDED: Record<string, string> = {
  git: "Required",
  "claude-code": "One of Claude Code or Codex is required",
  codex: "One of Claude Code or Codex is required",
};

/** The command a tool's Fix line says to run, when Office knows how to run it (the Codex install and update). */
function fixCommand(t: ToolStatus): string | null {
  const found = /npm i -g @openai[/]codex/.exec(t.fix ?? "");
  return t.id === "codex" && found ? found[0] : null;
}

/**
 * Which command-line tools are installed and logged in, with a fix for each problem. Logging in and installing
 * run in a terminal shown right here, so the owner never has to find it; when it ends the tools are checked
 * again. Used by the welcome flow and by Setup.
 */
export function ToolsStep() {
  const tools = useQuery("setup.detectTools", undefined, ["setup.changed"]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [run, setRun] = useState<ToolRun | null>(null);

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

  /** Opens the tool's login, or a command that fixes it, in a dialog of its own. */
  const start = async (kind: "login" | "run", tool: ToolStatus): Promise<void> => {
    setError(null);
    try {
      const session = await office.invoke(
        kind === "login" ? "setup.loginSession" : "setup.installSession",
        { id: tool.id },
      );
      setRun({
        session,
        kind,
        toolId: tool.id,
        toolLabel: tool.label,
        again: () => void start(kind, tool),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

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
              <Button onClick={() => void start("login", t)} data-testid="tool-login">
                Log in
              </Button>
            )}
            {t.installed && t.loggedIn !== false && t.problem && fixCommand(t) !== null && (
              <Button
                onClick={() => void start("run", t)}
                title={fixCommand(t) ?? undefined}
                data-testid="tool-run"
              >
                Run
              </Button>
            )}
            {!t.installed && t.id === "codex" && (
              <Button onClick={() => void start("run", t)} data-testid="tool-install">
                Install (npm i -g @openai/codex)
              </Button>
            )}
          </div>
        ))}
      </div>
      {run && (
        <ToolRunDialog
          run={run}
          onClose={() => {
            setRun(null);
            void recheck();
          }}
        />
      )}
    </div>
  );
}
