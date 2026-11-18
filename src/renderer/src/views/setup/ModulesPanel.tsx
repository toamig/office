import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

/** Optional modules from the app data folder. Off by default; enabling one asks you to accept the risk first. */
export function ModulesPanel() {
  const modules = useQuery("modules.list");
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = async (name: string, enabled: boolean): Promise<void> => {
    setError(null);
    try {
      await office.invoke("modules.setEnabled", { name, enabled });
      setAsking(null);
      modules.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Panel title="Modules">
      <p className="mt-0 text-[12.5px]" style={{ color: "var(--muted)" }}>
        Modules add a notification channel, an agent provider or a quick switcher source. Put one in
        the
        <code> modules </code>
        folder of Office&apos;s data folder (see examples/modules). None runs until you enable it
        here.
      </p>
      {(error || modules.error) && <ErrorBanner message={error ?? modules.error ?? ""} />}
      <div data-testid="modules">
        {modules.data?.length === 0 && <EmptyState>No modules installed.</EmptyState>}
        {modules.data?.map((m) => (
          <div
            key={m.name}
            className="border-b py-2"
            style={{ borderColor: "var(--line)" }}
            data-testid="module-row"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{m.name}</span>
              {m.kind && <Chip>{m.kind}</Chip>}
              {m.loaded && <Chip tone="good">running</Chip>}
              {m.error && <Chip tone="bad">failed</Chip>}
              <div className="flex-1" />
              {m.enabled ? (
                <Button onClick={() => void set(m.name, false)} data-testid="module-disable">
                  Disable
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => setAsking(m.name)}
                  data-testid="module-enable"
                >
                  Enable...
                </Button>
              )}
            </div>
            {m.description && (
              <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                {m.description}
              </div>
            )}
            {m.error && (
              <div className="text-[12.5px]" style={{ color: "var(--bad)" }}>
                {m.error}
              </div>
            )}
            {asking === m.name && (
              <div
                className="mt-2 flex items-start gap-2 rounded border px-3 py-2"
                style={{ borderColor: "var(--warn)" }}
                data-testid="module-warning"
              >
                <TriangleAlert size={16} style={{ color: "var(--warn)" }} />
                <div className="flex-1">
                  Modules run with full access to your files and accounts. Only enable a module you
                  wrote or trust.
                </div>
                <Button
                  variant="primary"
                  onClick={() => void set(m.name, true)}
                  data-testid="module-confirm"
                >
                  I understand, enable it
                </Button>
                <Button onClick={() => setAsking(null)}>Cancel</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
