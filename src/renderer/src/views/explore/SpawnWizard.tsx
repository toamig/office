import { useEffect, useState } from "react";
import type { SpawnInput, SpawnReport, SpawnStep } from "@shared/models";
import { Banner, Button, Dialog, Dropdown, StatusBadge, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";

const DOMAINS: Record<SpawnInput["domain"], string> = {
  saas: "Software as a service",
  webgames: "Web games",
  mobile: "Mobile apps",
  ue5: "Unreal Engine 5",
  meta: "Tools and meta",
};

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
    try {
      setSteps(await office.invoke("explore.plan", input));
    } catch (err) {
      notifyError(err, "The project steps could not be prepared", "spawn");
    }
  };
  const go = async (): Promise<void> => {
    setRunning(true);
    try {
      const result = await office.invoke("explore.spawn", input);
      setReport(result);
      setSteps(result.steps);
    } catch (err) {
      notifyError(err, "The project steps could not be prepared", "spawn");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      title="Make this a project"
      testId="spawn-wizard"
      wide
      onClose={onClose}
      footer={
        <>
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
        </>
      }
    >
      <div>
        {!steps && (
          <div className="grid gap-2.5">
            <label className="grid grid-cols-[120px_1fr] items-center gap-2">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="spawn-name"
              />
            </label>
            <label className="grid grid-cols-[120px_1fr] items-center gap-2">
              Folder
              <input
                value={folder}
                placeholder="under your projects folder; defaults to the name"
                onChange={(e) => setFolder(e.target.value)}
                data-testid="spawn-folder"
              />
            </label>
            <label className="grid grid-cols-[120px_1fr] items-center gap-2">
              Built on
              <input
                value={stack}
                placeholder="for example: a Node and React web app"
                onChange={(e) => setStack(e.target.value)}
                data-testid="spawn-stack"
              />
            </label>
            <label className="grid grid-cols-[120px_1fr] items-center gap-2">
              Notes domain
              <Dropdown
                value={domain}
                onChange={(e) => setDomain(e.target.value as SpawnInput["domain"])}
              >
                {(Object.keys(DOMAINS) as Array<SpawnInput["domain"]>).map((d) => (
                  <option key={d} value={d}>
                    {DOMAINS[d]}
                  </option>
                ))}
              </Dropdown>
            </label>
            <label className="grid grid-cols-[120px_1fr] items-center gap-2">
              Group
              <input
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
              <Dropdown
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
              </Dropdown>
            </label>
            {visibility === "public" && (
              <>
                <label className="grid grid-cols-[120px_1fr] items-center gap-2">
                  Licence
                  <Dropdown
                    value={license}
                    onChange={(e) => setLicense(e.target.value as "mit" | "none")}
                  >
                    <option value="mit">MIT</option>
                    <option value="none">None</option>
                  </Dropdown>
                </label>
                <label className="ui-outline-attention flex items-center gap-2 p-2">
                  <input
                    type="checkbox"
                    checked={publicOk}
                    onChange={(e) => setPublicOk(e.target.checked)}
                    data-testid="spawn-public-ok"
                  />
                  Yes, create a public repository on GitHub. Anyone will be able to see it.
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
                  {s.label}
                  <StatusBadge
                    status={
                      s.status === "running"
                        ? "running"
                        : s.status === "failed"
                          ? "failed"
                          : s.status === "done"
                            ? "done"
                            : "pending"
                    }
                  />
                </div>
                <ul className="m-0 mt-1 pl-8 text-[length:var(--text-sm)] ui-muted">
                  {s.detail.map((d) => (
                    <li key={d}>
                      <code>{d}</code>
                    </li>
                  ))}
                </ul>
                {s.result && <div className="pl-8 text-[length:var(--text-sm)]">{s.result}</div>}
              </li>
            ))}
          </ol>
        )}
        {report && !report.ok && (
          <Banner tone="danger" testId="spawn-failed">
            A step failed, so the wizard stopped. What was already created stays as it is; nothing
            is rolled back.
          </Banner>
        )}
      </div>
    </Dialog>
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
