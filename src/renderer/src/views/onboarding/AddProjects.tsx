import { useEffect, useState } from "react";
import type { OnboardingItem, OnboardingReport, ScanCandidate } from "@shared/models";
import { Button, Chip, EmptyState, ErrorBanner } from "../../components/ui";
import { Select } from "../../components/Select";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { fieldClass, fieldStyle } from "../setup/PathField";
import { PointerDialog } from "./PointerDialog";

interface Row {
  candidate: ScanCandidate;
  picked: boolean;
  name: string;
  group: string;
  notes: "new" | "link" | "none";
  /** For a brain hub: a new notes repo, or a folder in an existing one. */
  hub: "repo" | `folder:${string}`;
}

const baseName = (path: string): string =>
  path.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? path;

function rowOf(c: ScanCandidate): Row {
  return {
    candidate: c,
    picked: c.notes !== null,
    name: c.name,
    group: c.group === "Other" ? "" : c.group,
    notes: c.notes ? "link" : "new",
    hub: "repo",
  };
}

/**
 * Adding projects: the code repos found under the projects folder, each with a name, a group and what to do about
 * notes. Everything that will happen is listed before it runs; a failure stops and says what was and was not done.
 */
export function AddProjects({ onDone }: { onDone?: () => void }) {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const kind = workspace.data?.workspace?.vault.kind ?? "folder";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hubRepos, setHubRepos] = useState<string[]>([]);
  const [plan, setPlan] = useState<string[]>([]);
  const [report, setReport] = useState<OnboardingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pointer, setPointer] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    office.invoke("onboarding.scan").then(
      (found) => {
        if (!alive) return;
        setRows(found.candidates.map(rowOf));
        setHubRepos(found.hubRepos);
      },
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
    };
  }, []);

  const update = (i: number, patch: Partial<Row>): void =>
    setRows((all) => (all ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const items = (): OnboardingItem[] =>
    (rows ?? [])
      .filter((r) => r.picked && r.name.trim())
      .map((r) => ({
        path: r.candidate.path,
        name: r.name.trim(),
        ...(r.group.trim() ? { group: r.group.trim() } : {}),
        notes: r.notes,
        ...(r.notes === "link" && r.candidate.notes ? { linkFolder: r.candidate.notes } : {}),
        ...(r.notes === "new" && kind === "brain-hub"
          ? r.hub === "repo"
            ? { hub: "repo" as const }
            : { hub: "folder" as const, hubFolder: r.hub.slice("folder:".length) }
          : {}),
        domain: "saas" as const,
      }));

  const picked = (rows ?? []).filter((r) => r.picked).length;
  // What will happen is shown before anything runs.
  const key = JSON.stringify(items());
  useEffect(() => {
    let alive = true;
    const list = JSON.parse(key) as OnboardingItem[];
    if (list.length === 0) void Promise.resolve().then(() => alive && setPlan([]));
    else void office.invoke("onboarding.plan", { items: list }).then((p) => alive && setPlan(p));
    return () => {
      alive = false;
    };
  }, [key]);

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const done = await office.invoke("onboarding.add", { items: items() });
      setReport(done);
      if (done.ok) {
        const found = await office.invoke("onboarding.scan");
        setRows(found.candidates.map(rowOf));
        onDone?.();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const browse = async (): Promise<void> => {
    const path = await office.invoke("setup.pickFolder", { title: "Choose a project folder" });
    if (!path) return;
    setRows((all) =>
      [
        ...(all ?? []).filter((r) => r.candidate.path !== path),
        rowOf({
          path,
          name: baseName(path),
          remote: null,
          lastCommit: null,
          group: "Other",
          notes: null,
        }),
      ].map((r) => (r.candidate.path === path ? { ...r, picked: true } : r)),
    );
  };

  return (
    <div data-testid="add-projects">
      {error && <ErrorBanner message={error} />}
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1" style={{ color: "var(--muted)" }}>
          Code repos under your projects folder that are not in Office yet.
        </span>
        <Button onClick={() => void browse()} data-testid="add-browse">
          Add a folder
        </Button>
        <Button
          variant="ghost"
          onClick={() => setRows((all) => (all ?? []).map((r) => ({ ...r, picked: true })))}
          data-testid="add-select-all"
        >
          Select all
        </Button>
      </div>
      {rows !== null && rows.length === 0 && (
        <EmptyState>
          Nothing new here: every repo under the projects folder is already in Office.
        </EmptyState>
      )}
      <div data-testid="scan-list">
        {(rows ?? []).map((r, i) => (
          <div
            key={r.candidate.path}
            className="grid items-center gap-2 border-b py-1.5"
            style={{ borderColor: "var(--line)", gridTemplateColumns: "24px 1.3fr 1fr 1.2fr" }}
            data-testid="scan-row"
          >
            <input
              type="checkbox"
              checked={r.picked}
              onChange={(e) => update(i, { picked: e.target.checked })}
              aria-label={`Add ${r.name}`}
              data-testid="scan-pick"
            />
            <div>
              <input
                className={`${fieldClass} w-full`}
                style={fieldStyle}
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
                aria-label="Name"
                data-testid="scan-name"
              />
              <div
                className="mt-0.5 truncate text-[11.5px]"
                style={{ color: "var(--muted)" }}
                title={r.candidate.path}
              >
                {baseName(r.candidate.path)}
                {r.candidate.remote ? `, ${r.candidate.remote}` : ""}
                {r.candidate.lastCommit
                  ? `, last commit ${r.candidate.lastCommit.slice(0, 10)}`
                  : ""}
              </div>
            </div>
            <input
              className={`${fieldClass} w-full`}
              style={fieldStyle}
              value={r.group}
              placeholder="Group"
              onChange={(e) => update(i, { group: e.target.value })}
              aria-label="Group"
              data-testid="scan-group"
            />
            <div className="flex items-center gap-1.5">
              {r.candidate.notes && <Chip tone="good">notes found</Chip>}
              <Select
                value={r.notes === "new" && kind === "brain-hub" ? `new-${r.hub}` : r.notes}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("new-"))
                    update(i, { notes: "new", hub: v.slice(4) as Row["hub"] });
                  else update(i, { notes: v as Row["notes"] });
                }}
                aria-label="Notes"
                data-testid="scan-notes"
                className="rounded border px-1 py-0.5"
                style={{
                  borderColor: "var(--line)",
                  background: "var(--panel)",
                  color: "var(--text)",
                }}
              >
                {kind === "brain-hub" ? (
                  <>
                    <option value="new-repo">New notes repo</option>
                    {hubRepos.map((h) => (
                      <option key={h} value={`new-folder:${h}`}>
                        Folder in {h}
                      </option>
                    ))}
                  </>
                ) : (
                  <option value="new">New notes</option>
                )}
                {r.candidate.notes && <option value="link">Use the notes found</option>}
                <option value="none">No notes</option>
              </Select>
            </div>
          </div>
        ))}
      </div>
      {plan.length > 0 && (
        <div
          className="mt-3 rounded border p-3"
          style={{ borderColor: "var(--line)" }}
          data-testid="add-plan"
        >
          <div className="mb-1 font-medium">This will:</div>
          <ul className="m-0 pl-5">
            {plan.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {report && (
        <div className="mt-3" data-testid="add-report">
          {report.steps.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-0.5">
              <Chip tone={s.status === "done" ? "good" : "bad"}>
                {s.status === "done" ? "Added" : "Failed"}
              </Chip>
              <span>{s.label}</span>
              {s.status === "failed" && <span style={{ color: "var(--bad)" }}>{s.result}</span>}
            </div>
          ))}
          {!report.ok && (
            <div style={{ color: "var(--muted)" }}>
              It stopped at the one that failed; the ones before it are added, the ones after it are
              not.
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          disabled={busy || picked === 0}
          onClick={() => void add()}
          data-testid="add-confirm"
        >
          {busy ? "Adding..." : `Add ${picked} project${picked === 1 ? "" : "s"}`}
        </Button>
        {report?.ok && report.steps.length > 0 && (
          <Button
            onClick={() =>
              setPointer(report.steps.filter((s) => s.status === "done").map((s) => s.result ?? ""))
            }
            data-testid="add-pointer-open"
          >
            Add the agent pointer to these repos
          </Button>
        )}
      </div>
      {pointer && <PointerDialog ids={pointer} onClose={() => setPointer(null)} />}
    </div>
  );
}
