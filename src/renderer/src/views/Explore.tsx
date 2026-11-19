import { useState } from "react";
import { StatusChip } from "../components/StatusChip";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Button, Dropdown, EmptyState, Page, SplitPane, Time, notifyError } from "../ui";
import { SessionSurface } from "./agents/SessionSurface";
import { SpawnWizard } from "./explore/SpawnWizard";

/** A general chat for exploring ideas, not tied to any project; one action turns an idea into a project. */
export function Explore() {
  const sessions = useQuery("explore.list", undefined, ["session.status"]);
  const providers = useQuery("providers.list");
  const [active, setActive] = useState<string | null>(null);
  const [provider, setProvider] = useState("claude-code");
  const [wizard, setWizard] = useState(false);

  const list = sessions.data ?? [];
  const current = list.find((s) => s.id === active) ?? list[0];

  const start = async (): Promise<void> => {
    try {
      const session = await office.invoke("explore.start", { providerId: provider });
      sessions.reload();
      setActive(session.id);
    } catch (err) {
      notifyError(err, "Could not start an exploration", "explore");
    }
  };

  const listPane = (
    <div data-testid="explore-list">
      {list.length === 0 && (
        <EmptyState
          title="No explorations yet"
          action={
            <Button variant="primary" onClick={() => void start()}>
              New exploration
            </Button>
          }
        >
          Think an idea through in a chat that can read your brain.
        </EmptyState>
      )}
      {list.map((s) => (
        <div
          key={s.id}
          data-testid="explore-row"
          className="ui-row"
          role="button"
          tabIndex={0}
          data-clickable="true"
          data-selected={current?.id === s.id ? "true" : undefined}
          onClick={() => setActive(s.id)}
          onKeyDown={(e) => e.key === "Enter" && setActive(s.id)}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{s.title}</div>
            <div className="ui-badges ui-line-sub">
              <StatusChip status={s.status} />
              <Time iso={s.updatedAt} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Page
      title="Explore"
      subtitle="A chat for ideas, research and questions, with no project attached."
      testId="explore"
      fill
      primary={
        <Button variant="primary" onClick={() => void start()} data-testid="explore-start">
          New exploration
        </Button>
      }
      more={[
        {
          label: "Make this a project...",
          onSelect: () => current && setWizard(true),
          testId: "make-project",
        },
      ]}
    >
      <div className="flex flex-none items-center gap-2">
        <Dropdown
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label="Explore with"
          data-testid="explore-provider"
        >
          {(providers.data ?? [])
            .filter((p) => p.installed)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
        </Dropdown>
      </div>
      <SplitPane
        id="explore"
        defaultSize={300}
        min={220}
        minSecond={420}
        first={listPane}
        second={
          <div className="ui-panel-bg h-full">
            {current ? (
              <SessionSurface
                key={current.id}
                session={current}
                onChanged={() => sessions.reload()}
              />
            ) : null}
          </div>
        }
      />
      {wizard && current && (
        <SpawnWizard exploreSessionId={current.id} onClose={() => setWizard(false)} />
      )}
    </Page>
  );
}
