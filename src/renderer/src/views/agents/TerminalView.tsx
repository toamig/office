import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { terminalTheme } from "@shared/theme";
import { office } from "../../lib/ipc";
import { terminalKeyAction } from "../../lib/keys";
import { FIND_EVENT } from "../../lib/shortcuts";
import { useTheme } from "../../lib/theme";

const SCROLLBACK_LINES = 10_000;
/** The terminal's own text size, in pixels (xterm draws it, so it is a number and not a token). */
const TERMINAL_FONT_SIZE = 13;
const FONT = '"Cascadia Mono", Consolas, ui-monospace, monospace';

/**
 * One xterm.js terminal attached to a main-process pty, dressed like the panel around it: its colours come
 * from the theme and change with it, the font is the app's code font, and Ctrl+F searches the scrollback.
 * History first, then live output.
 */
export function TerminalView({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const { theme, accent } = useTheme();
  const themeRef = useRef(terminalTheme(theme, accent));
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const findInput = useRef<HTMLInputElement>(null);

  // The find box takes the focus as soon as it is on screen.
  useEffect(() => {
    if (finding) findInput.current?.focus();
  }, [finding]);

  useEffect(() => {
    themeRef.current = terminalTheme(theme, accent);
    const term = termRef.current;
    if (term) term.options.theme = themeRef.current;
  }, [theme, accent]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      scrollback: SCROLLBACK_LINES,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.25,
      fontFamily: FONT,
      cursorBlink: true,
      allowProposedApi: true,
      theme: themeRef.current,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(search);
    term.open(el);
    // The GPU renderer when there is one; if its context is lost the default renderer takes over.
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      term.loadAddon(gl);
    } catch {
      /* no WebGL here: the default renderer stays */
    }
    // The program comes first (plan 12.1): every plain Ctrl+letter goes to it, the clipboard works as in
    // Windows Terminal, and only the keys no terminal program needs stay Office's.
    term.attachCustomKeyEventHandler((e) => {
      const action = terminalKeyAction(e, term.hasSelection());
      if (action === "program") return true;
      if (action === "app") return false;
      e.preventDefault();
      if (action === "copy") {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
      } else {
        void navigator.clipboard.readText().then((text) => term.paste(text));
      }
      return false;
    });
    termRef.current = term;
    // The terminal is reachable from the page for tests that check its theme.
    (el as unknown as { __term?: Terminal }).__term = term;
    searchRef.current = search;

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
      // A terminal that is kept alive while its view is hidden has no size: leave the program's size alone.
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
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

    // Ctrl+F opens the find of the terminal that has the focus.
    const onFind = (): void => {
      if (el.contains(document.activeElement) || el.matches(":hover")) {
        setFinding(true);
      }
    };
    window.addEventListener(FIND_EVENT, onFind);

    // Right click: a native menu with Copy and Paste, carried out here.
    const onContext = (e: MouseEvent): void => {
      e.preventDefault();
      void office.invoke("app.terminalMenu", { hasSelection: term.hasSelection() });
    };
    el.addEventListener("contextmenu", onContext);
    const offAction = office.on("app.terminal-action", (e) => {
      if (!el.contains(document.activeElement) && !el.matches(":hover")) return;
      if (e.payload === "copy") void navigator.clipboard.writeText(term.getSelection());
      if (e.payload === "paste") void navigator.clipboard.readText().then((t) => term.paste(t));
    });

    return () => {
      window.removeEventListener(FIND_EVENT, onFind);
      el.removeEventListener("contextmenu", onContext);
      offAction();
      observer.disconnect();
      typed.dispose();
      offData();
      termRef.current = null;
      searchRef.current = null;
      term.dispose();
    };
  }, [id]);

  const find = (backwards: boolean): void => {
    if (!query) return;
    if (backwards) searchRef.current?.findPrevious(query);
    else searchRef.current?.findNext(query);
  };

  const closeFind = (): void => {
    setFinding(false);
    termRef.current?.focus();
  };

  return (
    <div className="terminal-frame" data-testid="terminal-frame">
      {finding && (
        <div className="terminal-find" data-testid="terminal-find">
          <input
            ref={findInput}
            value={query}
            placeholder="Find in terminal"
            aria-label="Find in terminal"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") find(e.shiftKey);
              if (e.key === "Escape") closeFind();
            }}
            data-testid="terminal-find-input"
          />
          <button className="bar-button" aria-label="Previous match" onClick={() => find(true)}>
            <ChevronUp size={14} />
          </button>
          <button className="bar-button" aria-label="Next match" onClick={() => find(false)}>
            <ChevronDown size={14} />
          </button>
          <button className="bar-button" aria-label="Close find" onClick={closeFind}>
            <X size={14} />
          </button>
        </div>
      )}
      <div ref={host} className="terminal-host" data-testid="terminal" data-session={id} />
    </div>
  );
}
