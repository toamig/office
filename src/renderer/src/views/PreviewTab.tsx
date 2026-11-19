import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PreviewState } from "@shared/models";
import { Button, EmptyState, IconButton, Input, notify, notifyError } from "../ui";
import { office } from "../lib/ipc";
import { useUi } from "../stores/ui";

/** A browser pane for the project's page or local dev server: back, forward, reload, open externally. */
export function PreviewTab({ projectId }: { projectId: string }) {
  const storeKey = `preview-url:${projectId}`;
  const [url, setUrl] = useState(() => localStorage.getItem(storeKey) ?? "");
  const [state, setState] = useState<PreviewState | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  // Dialogs sit in the page, and a native pane would cover them, so it steps aside while one is open.
  const covered = useUi((s) => s.switcherOpen || s.syncReport !== null);

  useEffect(() => {
    const send = (visible: boolean): void => {
      const r = holder.current?.getBoundingClientRect();
      if (r)
        void office.invoke("preview.bounds", {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          visible,
        });
    };
    send(!covered);
    const observer = new ResizeObserver(() => send(!covered));
    if (holder.current) observer.observe(holder.current);
    const timer = setInterval(() => send(!covered), 300);
    return () => {
      observer.disconnect();
      clearInterval(timer);
      void office.invoke("preview.bounds", { x: 0, y: 0, width: 0, height: 0, visible: false });
    };
  }, [covered]);

  useEffect(() => {
    void office.invoke("preview.state").then(setState);
    return office.on("preview.state", (e) => setState(e.payload as PreviewState));
  }, []);

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

  const go = async (target = url): Promise<void> => {
    if (!target.trim()) return;
    try {
      const next = await office.invoke("preview.open", { url: target });
      setState(next);
      setUrl(next.url || target);
      localStorage.setItem(storeKey, next.url || target);
    } catch (err) {
      notifyError(err, "Could not open that address", `preview-${projectId}`);
    }
  };
  const act = (action: "back" | "forward" | "reload" | "external"): void => {
    void office.invoke("preview.act", { action }).then(setState);
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
    <div data-testid="preview-tab">
      <form
        className="mb-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
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
