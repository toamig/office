import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PreviewState } from "@shared/models";
import { Button, EmptyState, ErrorBanner } from "../components/ui";
import { office } from "../lib/ipc";
import { useUi } from "../stores/ui";

/** A browser pane for the project's page or local dev server: back, forward, reload, open externally. */
export function PreviewTab({ projectId }: { projectId: string }) {
  const storeKey = `preview-url:${projectId}`;
  const [url, setUrl] = useState(() => localStorage.getItem(storeKey) ?? "");
  const [state, setState] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Something to say that is not a failure: no dev server was found. */
  const [note, setNote] = useState<string | null>(null);
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

  const go = async (target = url): Promise<void> => {
    if (!target.trim()) return;
    setError(null);
    setNote(null);
    try {
      const next = await office.invoke("preview.open", { url: target });
      setState(next);
      setUrl(next.url || target);
      localStorage.setItem(storeKey, next.url || target);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const act = (action: "back" | "forward" | "reload" | "external"): void => {
    void office.invoke("preview.act", { action }).then(setState);
  };
  const detect = async (): Promise<void> => {
    setError(null);
    setNote(null);
    const found = await office.invoke("preview.detect");
    if (found) {
      setUrl(found);
      await go(found);
    } else setNote("No dev server was found on the usual ports. Start it, or type its address.");
  };

  return (
    <div data-testid="preview-tab">
      <form
        className="mb-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Button
          type="button"
          disabled={!state?.canGoBack}
          onClick={() => act("back")}
          aria-label="Back"
          data-testid="preview-back"
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          type="button"
          disabled={!state?.canGoForward}
          onClick={() => act("forward")}
          aria-label="Forward"
          data-testid="preview-forward"
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          type="button"
          onClick={() => act("reload")}
          aria-label="Reload"
          data-testid="preview-reload"
        >
          <RefreshCw size={14} />
        </Button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="For example localhost:5173"
          aria-label="Address"
          data-testid="preview-url"
          className="flex-1 rounded border px-2 py-1"
          style={{ borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" }}
        />
        <Button type="submit" variant="primary" disabled={!url.trim()} data-testid="preview-go">
          Go
        </Button>
        <Button type="button" onClick={() => void detect()} data-testid="preview-detect">
          <Search size={14} /> Find dev server
        </Button>
        <Button
          type="button"
          disabled={!state?.open}
          onClick={() => act("external")}
          data-testid="preview-external"
        >
          <ExternalLink size={14} /> Open externally
        </Button>
      </form>
      {error && <ErrorBanner message={error} />}
      {note && (
        <p className="my-2" style={{ color: "var(--muted)" }} data-testid="preview-note">
          {note}
        </p>
      )}
      {state?.error && <ErrorBanner message={`The page did not load: ${state.error}`} />}
      <div
        ref={holder}
        data-testid="preview-holder"
        className="rounded border"
        style={{
          height: "calc(100vh - 220px)",
          minHeight: 240,
          borderColor: "var(--line)",
          background: "var(--panel)",
        }}
      >
        {!state?.open && (
          <EmptyState>
            Enter an address, or find the project&apos;s dev server, to preview it here.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
