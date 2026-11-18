import { Compass, Rocket } from "lucide-react";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner } from "../components/ui";
import { office } from "../lib/ipc";
import { timeAgo, useQuery } from "../lib/hooks";
import { SpawnWizard } from "./explore/SpawnWizard";
import { TerminalView } from "./agents/TerminalView";

/** A general chat for exploring ideas, not tied to any project; one action turns an idea into a project. */
export function Explore() {
  const sessions = useQuery("explore.list", undefined, ["session.status"]);
  const providers = useQuery("providers.list");
  const [active, setActive] = useState<string | null>(null);
  const [provider, setProvider] = useState("claude-code");
  const [wizard, setWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = sessions.data ?? [];
  const current = list.find((s) => s.id === active) ?? list[0];

  const start = async (): Promise<void> => {
    setError(null);
    try {
      const session = await office.invoke("explore.start", { providerId: provider });
      sessions.reload();
      setActive(session.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="explore">
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--line)" }}
      >
        <Compass size={18} />
        <h1 className="m-0 mr-2 text-lg font-semibold">Explore</h1>
        <div className="flex-1" />
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label="Explore with"
          data-testid="explore-provider"
          className="rounded border px-1 py-0.5"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--text)" }}
        >
          {(providers.data ?? [])
            .filter((p) => p.installed)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
        </select>
        <Button variant="primary" onClick={() => void start()} data-testid="explore-start">
          New exploration
        </Button>
        <Button disabled={!current} onClick={() => setWizard(true)} data-testid="make-project">
          <Rocket size={13} /> Make this a project
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
      <div className="flex min-h-0 flex-1">
        <div
          className="w-64 shrink-0 overflow-auto border-r"
          style={{ borderColor: "var(--line)" }}
          data-testid="explore-list"
        >
          {list.length === 0 && (
            <EmptyState>
              Start an exploration to think an idea through. It can read your brain.
            </EmptyState>
          )}
          {list.map((s) => (
            <div
              key={s.id}
              data-testid="explore-row"
              onClick={() => setActive(s.id)}
              className="border-b px-3 py-2"
              style={{
                borderColor: "var(--line)",
                background: current?.id === s.id ? "var(--panel)" : "transparent",
              }}
            >
              <div className="truncate font-medium">{s.title}</div>
              <div
                className="flex items-center gap-2 text-[12px]"
                style={{ color: "var(--muted)" }}
              >
                <Chip>{s.status}</Chip> {timeAgo(s.updatedAt)}
              </div>
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1" style={{ background: "var(--panel)" }}>
          {current ? <TerminalView key={current.id} id={current.id} /> : null}
        </div>
      </div>
      {wizard && current && (
        <SpawnWizard exploreSessionId={current.id} onClose={() => setWizard(false)} />
      )}
    </div>
  );
}
