import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { OnboardingReport, PointerPreview } from "@shared/models";
import { Button, Chip, ErrorBanner } from "../../components/ui";
import { useEscape } from "../../lib/escape";
import { office } from "../../lib/ipc";

/**
 * The agent pointer: a short block between markers in each code repo's AGENTS.md saying where the notes are. The exact
 * text is shown first; nothing outside the markers is touched, only that file is committed locally, and nothing is
 * pushed unless Push is ticked. Uninstall takes the block out again.
 */
export function PointerDialog({
  ids,
  onClose,
  mode = "add",
}: {
  ids: string[];
  onClose: () => void;
  mode?: "add" | "remove";
}) {
  const [previews, setPreviews] = useState<PointerPreview[] | null>(null);
  const [push, setPush] = useState(false);
  const [target, setTarget] = useState<"auto" | "agents" | "local">("auto");
  const [report, setReport] = useState<OnboardingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose, true);

  useEffect(() => {
    let alive = true;
    void Promise.all(ids.map((id) => office.invoke("pointer.preview", { id }))).then(
      (list) => alive && setPreviews(list),
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, [ids]);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setReport(
        mode === "add"
          ? await office.invoke("pointer.apply", { ids, push, target })
          : await office.invoke("pointer.remove", { ids }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const first = previews?.[0];
  /** The file a repo's block goes in under the current choice. */
  const fileOf = (p: PointerPreview): "AGENTS.md" | "CLAUDE.local.md" =>
    (target === "auto" ? p.target : target) === "local" ? "CLAUDE.local.md" : "AGENTS.md";
  const createsOf = (p: PointerPreview): string[] =>
    (target === "auto" ? p.target : target) === "local" ? p.creates.local : p.creates.agents;
  const localOnly = previews?.some((p) => fileOf(p) === "CLAUDE.local.md") ?? false;
  const inRepo = previews?.some((p) => fileOf(p) === "AGENTS.md") ?? false;
  return createPortal(
    <div className="dialog-backdrop" data-testid="pointer-dialog">
      <div className="dialog w-[640px] max-w-[92vw]">
        <header className="dialog-header">
          <span className="font-semibold">
            {mode === "add" ? "Add the agent pointer" : "Remove the agent pointer"}
          </span>
        </header>
        <div className="overflow-auto p-4">
          {error && <ErrorBanner message={error} />}
          <p className="mt-0">
            {mode === "add"
              ? "Agents that open these repos will find where the notes are on this PC. Office adds a short block between two markers, and touches nothing outside them."
              : "Office takes its block out again, from AGENTS.md or CLAUDE.local.md, and leaves everything else as it was."}
          </p>
          {mode === "add" && first && (
            <>
              <fieldset className="m-0 mb-3 border-0 p-0" data-testid="pointer-target">
                <legend className="mb-1 p-0 font-semibold">Where the block goes</legend>
                {(
                  [
                    [
                      "auto",
                      "Choose for me",
                      "CLAUDE.local.md for a public repo, AGENTS.md for any other, and AGENTS.md when GitHub cannot say.",
                    ],
                    [
                      "agents",
                      "AGENTS.md",
                      "Committed with the repo and read by every agent tool. It holds a path that only exists on this PC.",
                    ],
                    [
                      "local",
                      "CLAUDE.local.md",
                      "Only on this PC: never committed (kept out of git through .git/info/exclude), and read by Claude Code only.",
                    ],
                  ] as const
                ).map(([value, label, help]) => (
                  <label key={value} className="mb-1 flex items-start gap-2">
                    <input
                      type="radio"
                      name="pointer-target"
                      checked={target === value}
                      onChange={() => setTarget(value)}
                      data-testid={`pointer-target-${value}`}
                    />
                    <span>
                      {label}
                      <span className="block" style={{ color: "var(--muted)" }}>
                        {help}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <ul className="m-0 mb-3 list-none p-0" data-testid="pointer-files">
                {previews?.map((p) => (
                  <li key={p.project}>
                    {p.project}: {fileOf(p)}
                    {p.visibility
                      ? ` (${p.visibility.toLowerCase()} repo)`
                      : " (visibility unknown)"}
                  </li>
                ))}
              </ul>
              <div className="mb-1 text-[12px]" style={{ color: "var(--muted)" }}>
                The exact text, for {first.project}
                {previews && previews.length > 1 ? ` and ${previews.length - 1} more` : ""}:
              </div>
              <pre
                className="m-0 whitespace-pre-wrap rounded border p-2 text-[12px]"
                style={{ borderColor: "var(--line)" }}
                data-testid="pointer-text"
              >
                {first.text}
              </pre>
              {previews?.some((p) => createsOf(p).length > 0) && (
                <p className="mb-0 mt-2" style={{ color: "var(--muted)" }}>
                  Where a repo has no such file, Office creates it
                  {inRepo ? " (and a CLAUDE.md that imports AGENTS.md, when neither exists)" : ""}.
                </p>
              )}
              {inRepo && (
                <>
                  <label className="mt-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={push}
                      onChange={(e) => setPush(e.target.checked)}
                      data-testid="pointer-push"
                    />{" "}
                    Push the commit too. Only tick this when the repo is one you want the pointer
                    published in.
                  </label>
                  <p className="mb-0 mt-2" style={{ color: "var(--muted)" }}>
                    The commit is local and holds only AGENTS.md.
                  </p>
                </>
              )}
              {localOnly && (
                <p className="mb-0 mt-2" style={{ color: "var(--muted)" }}>
                  CLAUDE.local.md is not committed or pushed.
                </p>
              )}
            </>
          )}
          {report && (
            <div className="mt-3" data-testid="pointer-report">
              {report.steps.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <Chip tone={s.status === "failed" ? "bad" : "good"}>
                    {s.status === "failed" ? "Failed" : "Done"}
                  </Chip>
                  <span>
                    {s.id}: {s.result}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer
          className="flex justify-end gap-2 border-t px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <Button onClick={onClose} data-testid="pointer-close">
            {report ? "Close" : "Cancel"}
          </Button>
          {!report && (
            <Button
              variant="primary"
              disabled={busy || !previews}
              onClick={() => void run()}
              data-testid="pointer-confirm"
            >
              {mode === "add" ? "Add the pointer" : "Remove it"}
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
