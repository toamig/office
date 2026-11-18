import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchItem } from "@shared/models";
import { office } from "../lib/ipc";
import { useUi, type ViewId } from "../stores/ui";

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
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
  return (
    <div
      className="dialog-backdrop"
      style={{ alignItems: "flex-start", paddingTop: 96 }}
      onClick={() => setSwitcherOpen(false)}
    >
      <div
        className="w-[560px] rounded border"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
        onClick={(e) => e.stopPropagation()}
        data-testid="switcher"
      >
        <input
          ref={input}
          value={query}
          placeholder="Jump to a project, note, branch, worktree or session"
          aria-label="Quick switcher"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[index]) open(results[index].item);
          }}
          className="w-full border-0 border-b bg-transparent px-3 py-2.5 outline-none"
          style={{ borderColor: "var(--line)", color: "var(--text)" }}
        />
        <ul className="m-0 max-h-80 list-none overflow-auto p-1">
          {results.length === 0 && (
            <li className="px-3 py-3 text-center" style={{ color: "var(--muted)" }}>
              Nothing matches. Try a project name.
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={`${r.item.kind}-${r.item.label}`}
              data-testid="switcher-item"
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(r.item)}
              className="flex items-center gap-2 rounded px-3 py-1.5"
              style={{ background: i === index ? "var(--rail)" : "transparent" }}
            >
              <span className="w-16 text-[11px] uppercase" style={{ color: "var(--muted)" }}>
                {kindLabel[r.item.kind]}
              </span>
              <span className="flex-1">{r.item.label}</span>
              {r.item.detail && <span style={{ color: "var(--muted)" }}>{r.item.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
