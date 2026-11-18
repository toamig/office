import { Check, CircleDashed, Loader, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { SpawnInput, SpawnReport, SpawnStep } from "@shared/models";
import { Button, Chip, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

const icon = (status: SpawnStep["status"]) =>
  status === "done" ? (
    <Check size={14} color="#2e9e5b" />
  ) : status === "failed" ? (
    <XCircle size={14} color="#cf4a4a" />
  ) : status === "running" ? (
    <Loader size={14} className="animate-spin" />
  ) : (
    <CircleDashed size={14} />
  );

/** Make this a project: name, visibility and a checklist that shows every step before it runs. */
export function SpawnWizard({
  exploreSessionId,
  onClose,
}: {
  exploreSessionId?: string;
  onClose: () => void;
}) {
  const navigate = useUi((s) => s.navigate);
  const groups = useGroups();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [license, setLicense] = useState<"mit" | "none">("none");
  const [group, setGroup] = useState("");
  const [stack, setStack] = useState("");
  const [domain, setDomain] = useState<SpawnInput["domain"]>("saas");
  const [publicOk, setPublicOk] = useState(false);
  const [steps, setSteps] = useState<SpawnStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SpawnReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input: SpawnInput = {
    name,
    ...(folder ? { folder } : {}),
    visibility,
    license: visibility === "public" ? license : "none",
    ...(group ? { group } : {}),
    stack,
    domain,
    ...(exploreSessionId ? { exploreSessionId } : {}),
    publicConfirmed: publicOk,
  };

  useEffect(
    () =>
      office.on("run.progress", (e) => {
        const p = e.payload as { kind: string; steps?: SpawnStep[] };
        if (p.kind === "spawn" && p.steps) setSteps(p.steps);
      }),
    [],
  );

  const review = async (): Promise<void> => {
    setError(null);
    try {
      setSteps(await office.invoke("explore.plan", input));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const go = async (): Promise<void> => {
    setError(null);
    setRunning(true);
    try {
      const result = await office.invoke("explore.spawn", input);
      setReport(result);
      setSteps(result.steps);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      data-testid="spawn-wizard"
    >
      <div
        className="flex max-h-[90vh] w-[720px] flex-col rounded border"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <h2 className="m-0 text-sm font-semibold">Make this a project</h2>
          <Button variant="ghost" aria-label="Close wizard" onClick={onClose}>
            <X size={14} />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="mb-3" data-testid="spawn-error">
              <ErrorBanner message={error} />
            </div>
          )}
          {!steps && (
            <div className="grid gap-2.5">
              <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                Name
                <input
                  className={field}
                  style={fieldStyle}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="spawn-name"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                Folder
                <input
                  className={field}
                  style={fieldStyle}
                  value={folder}
                  placeholder="under your projects folder; defaults to the name"
                  onChange={(e) => setFolder(e.target.value)}
                  data-testid="spawn-folder"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                Built on
                <input
                  className={field}
                  style={fieldStyle}
                  value={stack}
                  placeholder="for example: a Node and React web app"
                  onChange={(e) => setStack(e.target.value)}
                  data-testid="spawn-stack"
                />
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                Notes domain
                <select
                  className={field}
                  style={fieldStyle}
                  value={domain}
                  onChange={(e) => setDomain(e.target.value as SpawnInput["domain"])}
                >
                  {(["saas", "webgames", "mobile", "ue5", "meta"] as const).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                Group
                <input
                  className={field}
                  style={fieldStyle}
                  list="spawn-groups"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  data-testid="spawn-group"
                />
                <datalist id="spawn-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>
              <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                GitHub repo
                <select
                  className={field}
                  style={fieldStyle}
                  value={visibility}
                  onChange={(e) => {
                    const v = e.target.value as "public" | "private";
                    setVisibility(v);
                    setLicense(v === "public" ? "mit" : "none");
                    setPublicOk(false);
                  }}
                  data-testid="spawn-visibility"
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>
              {visibility === "public" && (
                <>
                  <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                    Licence
                    <select
                      className={field}
                      style={fieldStyle}
                      value={license}
                      onChange={(e) => setLicense(e.target.value as "mit" | "none")}
                    >
                      <option value="mit">MIT</option>
                      <option value="none">None</option>
                    </select>
                  </label>
                  <label
                    className="flex items-center gap-2 rounded border px-2 py-1.5"
                    style={{ borderColor: "#c98a12" }}
                  >
                    <input
                      type="checkbox"
                      checked={publicOk}
                      onChange={(e) => setPublicOk(e.target.checked)}
                      data-testid="spawn-public-ok"
                    />
                    Yes, create a PUBLIC repository on GitHub. Anyone will be able to see it.
                  </label>
                </>
              )}
            </div>
          )}
          {steps && (
            <ol className="m-0 list-none p-0" data-testid="spawn-steps">
              {steps.map((s) => (
                <li key={s.id} className="mb-3" data-testid="spawn-step" data-status={s.status}>
                  <div className="flex items-center gap-2 font-medium">
                    {icon(s.status)} {s.label}
                    <Chip
                      tone={
                        s.status === "failed" ? "bad" : s.status === "done" ? "good" : "neutral"
                      }
                    >
                      {s.status}
                    </Chip>
                  </div>
                  <ul className="m-0 mt-1 pl-8 text-[12.5px]" style={{ color: "var(--muted)" }}>
                    {s.detail.map((d) => (
                      <li key={d}>
                        <code>{d}</code>
                      </li>
                    ))}
                  </ul>
                  {s.result && <div className="pl-8 text-[12.5px]">{s.result}</div>}
                </li>
              ))}
            </ol>
          )}
          {report && !report.ok && (
            <div className="mt-2" data-testid="spawn-failed">
              <ErrorBanner message="A step failed, so the wizard stopped. What was already created stays as it is; nothing is rolled back." />
            </div>
          )}
        </div>
        <footer
          className="flex justify-end gap-2 border-t px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          {!steps && (
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => void review()}
              data-testid="spawn-review"
            >
              Review the steps
            </Button>
          )}
          {steps && !report && (
            <>
              <Button disabled={running} onClick={() => setSteps(null)}>
                Back
              </Button>
              <Button
                variant="primary"
                disabled={running || (visibility === "public" && !publicOk)}
                onClick={() => void go()}
                data-testid="spawn-run"
              >
                {running ? "Running..." : "Run these steps"}
              </Button>
            </>
          )}
          {report?.ok && (
            <Button
              variant="primary"
              data-testid="spawn-open"
              onClick={() => {
                onClose();
                navigate("project", { id: report.projectId ?? "" });
              }}
            >
              Open the project
            </Button>
          )}
          {report && !report.ok && <Button onClick={onClose}>Close</Button>}
        </footer>
      </div>
    </div>
  );
}

function useGroups(): string[] {
  const [groups, setGroups] = useState<string[]>([]);
  useEffect(() => {
    void office.invoke("workspace.get").then((w) => {
      setGroups([
        ...new Set(
          (w.workspace?.projects ?? []).map((p) => p.group).filter((g): g is string => Boolean(g)),
        ),
      ]);
    });
  }, []);
  return groups;
}
