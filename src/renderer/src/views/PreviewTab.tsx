import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewBounds, PreviewState } from "@shared/models";
import { Button, EmptyState, IconButton, Input, notify, notifyError } from "../ui";
import { office } from "../lib/ipc";
import { useNativeBounds } from "../lib/native-bounds";

/** A browser pane for the project's page or local dev server: back, forward, reload, open externally. */
export function PreviewTab({ projectId, owner, initialUrl, transient = false }: { projectId: string; owner?: string; initialUrl?: string; transient?: boolean }) {
  const storeKey = `preview-url:${owner ?? projectId}`;
  const [url, setUrl] = useState(() => localStorage.getItem(storeKey) ?? "");
  const [state, setState] = useState<PreviewState | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  useNativeBounds(holder, useCallback((bounds: PreviewBounds) => {
    void office.invoke("preview.bounds", { ...bounds, owner });
  }, [owner]));

  useEffect(() => {
    void office.invoke("preview.state", { owner }).then(setState);
    const off = office.on("preview.state", (e) => {
      const payload = e.payload as PreviewState & { owner?: string };
      if (payload.owner === owner) setState(payload);
    });
    return () => {
      off();
      if (owner) void office.invoke("preview.act", { action: "close", owner });
    };
  }, [owner]);

  // A page that did not load is a result, not a lasting state: it is a notification, and the layout never moves.
  const loadError = state?.error ?? null;
  useEffect(() => {
    if (loadError)
      notify({
        tone: "danger",
        title: "The page did not load",
        detail: loadError,
        subject: `preview-${projectId}`,
      });
  }, [loadError, projectId]);

  const go = useCallback(async (target: string): Promise<void> => {
    if (!target.trim()) return;
    try {
      const next = await office.invoke("preview.open", { url: target, owner });
      setState(next);
      setUrl(next.url || target);
      if (!transient) localStorage.setItem(storeKey, next.url || target);
    } catch (err) {
      notifyError(err, "Could not open that address", `preview-${projectId}`);
    }
  }, [owner, projectId, storeKey, transient]);
  useEffect(() => {
    const target = initialUrl ?? (owner && !transient ? localStorage.getItem(storeKey) : undefined);
    if (target) void go(target);
  }, [initialUrl, owner, storeKey, transient, go]);
  const act = (action: "back" | "forward" | "reload" | "external"): void => {
    void office.invoke("preview.act", { action, owner }).then(setState);
  };
  const detect = async (): Promise<void> => {
    const found = await office.invoke("preview.detect");
    if (found) {
      setUrl(found);
      await go(found);
    } else
      notify({
        tone: "info",
        title: "No dev server found",
        detail: "Start it, or type its address.",
        subject: `preview-${projectId}`,
      });
  };

  return (
    <div data-testid="preview-tab" className="flex h-full flex-col p-3">
      <form
        className="mb-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go(url);
        }}
      >
        <IconButton
          label="Back"
          disabled={!state?.canGoBack}
          onClick={() => act("back")}
          data-testid="preview-back"
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!state?.canGoForward}
          onClick={() => act("forward")}
          data-testid="preview-forward"
        >
          <ArrowRight />
        </IconButton>
        <IconButton label="Reload" onClick={() => act("reload")} data-testid="preview-reload">
          <RefreshCw />
        </IconButton>
        <Input
          className="flex-1"
          label="Address"
          hideLabel
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="For example localhost:5173"
          data-testid="preview-url"
        />
        <Button type="submit" variant="primary" disabled={!url.trim()} data-testid="preview-go">
          Go
        </Button>
        <Button type="button" onClick={() => void detect()} data-testid="preview-detect">
          <Search /> Find dev server
        </Button>
        <Button
          type="button"
          disabled={!state?.open}
          onClick={() => act("external")}
          data-testid="preview-external"
        >
          <ExternalLink /> Open externally
        </Button>
      </form>
      <div ref={holder} data-testid="preview-holder" className="ui-preview-holder">
        {!state?.open && (
          <EmptyState title="Nothing to preview yet">
            Enter an address, or find the project&apos;s dev server, to preview it here.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
