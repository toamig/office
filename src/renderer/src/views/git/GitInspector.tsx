import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { Button, Card, StatusBadge, Time, notifyError } from "../../ui";

/** The chosen repo on the side: where it stands, its last commit, and what you can do with it. */
export function GitInspector({ projectId }: { projectId: string }) {
  const detail = useQuery("projects.get", { id: projectId }, ["project.status"]);
  const d = detail.data;
  const run = async (title: string, work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      notifyError(err, title, `git-${projectId}`);
    }
  };
  if (!d) return null;
  const s = d.status;
  return (
    <Card title={d.summary.name} testId="git-inspector">
      <dl className="ui-dl">
        <dt>Branch</dt>
        <dd>{s ? (s.detached ? "Detached HEAD" : s.branch) : "Not a repo"}</dd>
        <dt>Upstream</dt>
        <dd>{s?.upstream ?? "None"}</dd>
        <dt>To push and pull</dt>
        <dd className="ui-badges">
          {s && s.ahead === 0 && s.behind === 0 && <StatusBadge status="up-to-date" />}
          {s && s.ahead > 0 && <StatusBadge status="ahead" label={`${s.ahead} to push`} />}
          {s && s.behind > 0 && <StatusBadge status="behind" label={`${s.behind} to pull`} />}
        </dd>
        <dt>Changed files</dt>
        <dd className="num">{s?.files.length ?? 0}</dd>
        <dt>Last commit</dt>
        <dd>
          {d.lastCommit ? (
            <>
              {d.lastCommit.subject}
              <div className="ui-line-sub">
                <code>{d.lastCommit.hash.slice(0, 8)}</code>, <Time iso={d.lastCommit.date} />
              </div>
            </>
          ) : (
            "None yet"
          )}
        </dd>
        <dt>Origin</dt>
        <dd className="break-all">{d.origin ?? "None"}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void run("Could not open the editor", () =>
              office.invoke("projects.openEditor", { id: projectId }),
            )
          }
        >
          Open in editor
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void run("Could not open the folder", () =>
              office.invoke("projects.openFolder", { id: projectId }),
            )
          }
        >
          Open folder
        </Button>
      </div>
    </Card>
  );
}
