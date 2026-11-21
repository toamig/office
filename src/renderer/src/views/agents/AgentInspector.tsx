import { AUTONOMY_LEVELS } from "@shared/autonomy";
import type { SessionRow } from "@shared/models";
import { StatusChip } from "../../components/StatusChip";
import { useQuery } from "../../lib/hooks";
import { Card, Group, ShortPath, Time } from "../../ui";

/** The details of the selected session: where it works, what it is allowed, what it has changed, what waits on you. */
export function AgentInspector({ session }: { session: SessionRow | undefined }) {
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const requests = useQuery("permissions.list", undefined, ["permission.changed"]);
  const chat = useQuery("chat.state", { id: session?.id ?? "" }, ["session.status"]);
  const status = useQuery(
    "git.status",
    { projectId: session?.projectId ?? "", dir: session?.cwd ?? "" },
    ["project.status"],
  );
  if (!session) {
    return (
      <Card title="Session" testId="agent-inspector">
        <p className="ui-muted m-0">Pick a session to see where it works and what it has done.</p>
      </Card>
    );
  }
  const project = projects.data?.find((p) => p.id === session.projectId)?.name;
  const role = session.role ? workspace.data?.workspace?.roles[session.role] : undefined;
  const waiting = (requests.data ?? []).filter((r) => r.runId === session.id);
  const changed = session.projectId && !status.error ? (status.data?.files ?? []) : [];
  const state = chat.data;
  return (
    <>
      <Card title={session.title ?? "Session"} testId="agent-inspector">
        <dl className="ui-dl">
          <dt>Status</dt>
          <dd>
            <StatusChip status={session.status} />
          </dd>
          <dt>Project</dt>
          <dd>{project ?? "None"}</dd>
          <dt>Branch</dt>
          <dd>{session.branch ?? "None"}</dd>
          <dt>Folder</dt>
          <dd>
            <ShortPath path={session.cwd} />
          </dd>
          <dt>Provider</dt>
          <dd>{session.provider === "claude-code" ? "Claude Code" : session.provider}</dd>
          {session.role && (
            <>
              <dt>Role</dt>
              <dd>{session.role}</dd>
            </>
          )}
          <dt>Model</dt>
          <dd>{state?.options.model ?? role?.model ?? "The tool's default"}</dd>
          {role?.effort && (
            <>
              <dt>Effort</dt>
              <dd>{role.effort}</dd>
            </>
          )}
          {session.autonomy && (
            <>
              <dt>Autonomy</dt>
              <dd>{AUTONOMY_LEVELS[session.autonomy].label}</dd>
            </>
          )}
          <dt>Started</dt>
          <dd>
            <Time iso={session.createdAt} />
          </dd>
          <dt>Last active</dt>
          <dd>
            <Time iso={session.updatedAt} />
          </dd>
        </dl>
      </Card>
      <Card title={`Waiting on you (${waiting.length})`} testId="agent-waiting">
        {waiting.length === 0 && <p className="ui-muted m-0">Nothing is waiting on you here.</p>}
        {waiting.map((r) => (
          <div key={r.id} className="ui-line">
            <div className="ui-line-main">
              <div>Wants to run</div>
              <code className="ui-path">{r.summary}</code>
            </div>
          </div>
        ))}
      </Card>
      <Card title={`Files changed (${changed.length})`} testId="agent-files">
        {changed.length === 0 && <p className="ui-muted m-0">No changes in this folder.</p>}
        <Group>In {session.cwd.split(/[\\/]/).pop()}</Group>
        <ul className="m-0 max-h-60 list-none overflow-auto p-0">
          {changed.slice(0, 80).map((f) => (
            <li key={f.path} className="ui-path">
              <span className="ui-muted">
                {f.index}
                {f.worktree}
              </span>{" "}
              {f.path}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
