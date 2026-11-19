import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button, Card, EmptyState, StatusBadge, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

/** Optional modules from the app data folder. Off by default; enabling one asks you to accept the risk first. */
export function ModulesPanel() {
  const modules = useQuery("modules.list");
  const [asking, setAsking] = useState<string | null>(null);

  const set = async (name: string, enabled: boolean): Promise<void> => {
    try {
      await office.invoke("modules.setEnabled", { name, enabled });
      setAsking(null);
      modules.reload();
    } catch (err) {
      notifyError(err, "That module was not changed", "modules");
    }
  };

  return (
    <Card title="Modules" testId="panel-modules">
      <p className="ui-muted mt-0">
        Modules add a notification channel, an agent provider or a quick switcher source. Put one in
        the
        <code> modules </code>
        folder of Office&apos;s data folder (see examples/modules). None runs until you enable it
        here.
      </p>
      {modules.error && <p className="ui-bad">{modules.error}</p>}
      <div data-testid="modules">
        {modules.data?.length === 0 && (
          <EmptyState title="No modules installed">
            Drop one into the modules folder to see it here.
          </EmptyState>
        )}
        {modules.data?.map((m) => (
          <div key={m.name} className="ui-line" data-testid="module-row">
            <div className="ui-line-main">
              <div className="flex items-center gap-2">
                <span className="font-medium">{m.name}</span>
                {m.kind && <span className="ui-muted">{m.kind}</span>}
                {m.loaded && <StatusBadge status="working" label="Running" />}
                {m.error && <StatusBadge status="failed" />}
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
                <div className="text-[length:var(--text-sm)] ui-muted">{m.description}</div>
              )}
              {m.error && <div className="text-[length:var(--text-sm)] ui-bad">{m.error}</div>}
              {asking === m.name && (
                <div className="ui-ask mt-2 flex items-start gap-2" data-testid="module-warning">
                  <TriangleAlert size={16} className="ui-warn" />
                  <div className="flex-1">
                    Modules run with full access to your files and accounts. Only enable a module
                    you wrote or trust.
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
          </div>
        ))}
      </div>
    </Card>
  );
}
