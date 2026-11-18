import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { office } from "../../lib/ipc";

const SCROLLBACK_LINES = 10_000;

/** One xterm.js terminal attached to a main-process pty. History first, then live output. */
export function TerminalView({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      scrollback: SCROLLBACK_LINES,
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
      cursorBlink: true,
      theme: { background: "#14161a", foreground: "#e6e8ea" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());
    term.open(el);

    // Live chunks that arrive before the history reply are held, then trimmed to the part history lacks.
    let upTo = -1;
    const pending: Array<[string, number]> = [];
    const write = (data: string, end: number): void => {
      if (end <= upTo) return;
      const start = end - data.length;
      term.write(start < upTo ? data.slice(upTo - start) : data);
      upTo = end;
    };
    const offData = office.pty.onData(id, (data, end) => {
      if (upTo < 0) pending.push([data, end]);
      else write(data, end);
    });
    void office.invoke("sessions.history", { id }).then((history) => {
      term.write(history.data);
      upTo = history.upTo;
      for (const [data, end] of pending.splice(0)) write(data, end);
    });
    const typed = term.onData((data) => office.pty.write(id, data));

    const refit = (): void => {
      try {
        fit.fit();
        office.pty.resize(id, term.cols, term.rows);
      } catch {
        /* the pane is hidden or has no size yet */
      }
    };
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    refit();

    return () => {
      observer.disconnect();
      typed.dispose();
      offData();
      term.dispose();
    };
  }, [id]);

  return <div ref={host} className="h-full w-full" data-testid="terminal" data-session={id} />;
}
