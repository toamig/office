import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchItem } from "@shared/models";
import { office } from "../lib/ipc";
import { useUi, type ViewId } from "../stores/ui";
import { openRequest, sendRequest } from "../lib/request";
import { Button, notify, notifyError } from "../ui";

/** Subsequence fuzzy score: higher is better, -1 means no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at < 0) return -1;
    score += at === last + 1 ? 3 : 1;
    if (at === 0 || " :-/".includes(t[at - 1] ?? "")) score += 2;
    last = at;
    from = at + 1;
  }
  return score - t.length * 0.01;
}

const kindLabel: Record<SearchItem["kind"], string> = {
  project: "Project",
  note: "Note",
  branch: "Branch",
  worktree: "Worktree",
  session: "Session",
};

/** Ctrl+K: jump to any project, note, branch, worktree or session. */
export function QuickSwitcher() {
  const switcherOpen = useUi((s) => s.switcherOpen);
  const setSwitcherOpen = useUi((s) => s.setSwitcherOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // In a terminal Ctrl+K belongs to the program (readline kills the line with it).
      const inTerminal = Boolean((document.activeElement as Element | null)?.closest?.(".xterm"));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !inTerminal) {
        e.preventDefault();
        setSwitcherOpen(!useUi.getState().switcherOpen);
      } else if (e.key === "Escape") setSwitcherOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen]);
  return switcherOpen ? <SwitcherPanel /> : null;
}

function SwitcherPanel() {
  const setSwitcherOpen = useUi((s) => s.setSwitcherOpen);
  const navigate = useUi((s) => s.navigate);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void office.invoke("search.items").then(setItems, () => setItems([]));
    input.current?.focus();
  }, []);

  const results = useMemo(() => {
    const scored = items
      .map((item) => {
        const raw = fuzzyScore(query, `${item.label} ${item.detail ?? ""}`);
        // Projects win ties: typing a project name should open the project, not its branch.
        return { item, score: raw < 0 ? -1 : raw + (item.kind === "project" ? 2 : 0) };
      })
      .filter((r) => r.score >= 0);
    return scored.sort((a, b) => b.score - a.score).slice(0, 30);
  }, [items, query]);

  const open = (item: SearchItem): void => {
    setSwitcherOpen(false);
    navigate(item.link.view as ViewId, item.link.params ?? {});
  };
  const ask = async (): Promise<void> => {
    if (!query.trim() || busy) return;
    setBusy(true);
    try {
      const result = await sendRequest(query.trim());
      setSwitcherOpen(false);
      notify({ tone: "success", title: result.message, subject: "request", action: {
        label: "Open", run: () => openRequest(result),
      } });
    } catch (error) {
      notifyError(error, "Office could not act on that request", "request");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ui-scrim" data-align="top" onClick={() => setSwitcherOpen(false)}>
      <div
        className="ui-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to anything"
        onClick={(e) => e.stopPropagation()}
        data-testid="switcher"
      >
        <input
          ref={input}
          value={query}
          placeholder="Ask Office or jump to something"
          aria-label="Quick switcher"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
            setSelected(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected(true);
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(true);
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const item = results[index]?.item;
              if (!e.shiftKey && item && (selected || !query.trim() || item.label.toLowerCase() === query.trim().toLowerCase()))
                open(item);
              else void ask();
            }
          }}
          className="ui-switcher-input"
        />
        {query.trim() && (
          <div className="p-2">
            <Button size="sm" disabled={busy} onClick={() => void ask()}>
              {busy ? "Working..." : "Ask Office"}
            </Button>
          </div>
        )}
        <ul className="m-0 max-h-80 list-none overflow-auto p-1">
          {results.length === 0 && (
            <li className="ui-muted p-3">Nothing matches. Try a project name.</li>
          )}
          {results.map((r, i) => (
            <li
              key={`${r.item.kind}-${r.item.label}`}
              data-testid="switcher-item"
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(r.item)}
              className="ui-row"
              data-selected={i === index ? "true" : undefined}
            >
              <span className="w-16 text-[length:var(--text-xs)] ui-muted">
                {kindLabel[r.item.kind]}
              </span>
              <span className="flex-1">{r.item.label}</span>
              {r.item.detail && <span className="ui-muted">{r.item.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
