import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

/** Which command-line tools are installed and logged in, with a fix for each problem. */
export function ToolsPanel() {
  const tools = useQuery("setup.detectTools");
  const [error, setError] = useState<string | null>(null);
  const act = async (channel: "setup.login" | "setup.install", id: string): Promise<void> => {
    setError(null);
    try {
      await office.invoke(channel, { id });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Panel
      title="Tools"
      action={
        <Button variant="ghost" onClick={tools.reload} aria-label="Check again">
          <RefreshCw size={13} /> Check again
        </Button>
      }
    >
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
              {t.problem && <div style={{ color: "var(--warn)" }}>{t.problem}</div>}
              {t.fix && <div style={{ color: "var(--muted)" }}>Fix: {t.fix}</div>}
            </div>
            {t.installed && t.loggedIn === false && (
              <Button onClick={() => void act("setup.login", t.id)} data-testid="tool-login">
                Log in
              </Button>
            )}
            {!t.installed && t.id === "codex" && (
              <Button onClick={() => void act("setup.install", t.id)} data-testid="tool-install">
                Install (npm i -g @openai/codex)
              </Button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
