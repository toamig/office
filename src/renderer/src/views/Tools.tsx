import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  TOOL_GROUPS, ToolGroup, groupOf, type ToolEdit, type ToolEditPreview, type ToolEntry,
} from "@shared/tool-config";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Banner, Button, Card, Dialog, Dropdown, EmptyState, OverflowMenu, Page, notifyDone, notifyError } from "../ui";
import { AddTool } from "./tools/AddTool";

const PROGRAMS: Record<ToolEntry["provider"], string> = { "claude-code": "Claude Code", codex: "Codex" };
const NOUNS: Record<ToolGroup, string> = {
  skills: "skill", connections: "connection", plugins: "plugin", automatic: "automatic action",
};
type Projects = Array<{ id: string; name: string }>;

/** The same tool in both agent programs is one row. */
interface Row { key: string; entries: ToolEntry[]; title: string; description: string; group: ToolGroup }

function rowsOf(entries: ToolEntry[]): Row[] {
  const rows = new Map<string, Row>();
  for (const entry of entries) {
    const group = groupOf(entry.kind);
    // Automatic actions differ by command, so they are never merged across programs.
    const key = [group, entry.title.toLowerCase(), entry.projectId ?? "", group === "automatic" ? entry.id : ""].join("\0");
    const row = rows.get(key);
    if (row) row.entries.push(entry);
    else rows.set(key, { key, entries: [entry], title: entry.title || entry.name, description: entry.description, group });
  }
  return [...rows.values()];
}

const isOn = (row: Row): boolean => row.entries.every((entry) => !entry.disabled);
const partly = (row: Row): boolean => !isOn(row) && row.entries.some((entry) => !entry.disabled);

/** Whether turning a tool off only switches it off; otherwise it is removed with a backup. */
const switchable = (entry: ToolEntry): boolean =>
  (entry.provider === "claude-code" && entry.kind === "plugin") || (entry.provider === "codex" && entry.kind !== "hook" && entry.kind !== "skill");

function sentence(action: ToolEdit["action"], row: Row, projects: Projects, destination?: string): string {
  const programs = row.entries.map((entry) => PROGRAMS[entry.provider]).filter((name, at, all) => all.indexOf(name) === at).join(" and ");
  const where = row.entries[0]?.projectId ? `in ${projects.find((project) => project.id === row.entries[0]?.projectId)?.name ?? "one project"}` : "everywhere";
  const what = `the ${row.title} ${NOUNS[row.group]}`;
  if (action === "enable") return `Turn on ${what} for ${programs}, ${where}.`;
  if (action === "move") return `Move ${what} for ${programs} to ${projects.find((project) => project.id === destination)?.name ?? "that project"}.`;
  if (action === "remove") return `Remove ${what} from ${programs}, ${where}. A backup is kept.`;
  return row.entries.every(switchable)
    ? `Turn off ${what} for ${programs}, ${where}.`
    : `Remove ${what} from ${programs}, ${where}. A backup is kept, and you can add it again.`;
}

export function Tools() {
  const projects = useQuery("projects.list", undefined, ["workspace.changed"]);
  const [projectId, setProjectId] = useState("");
  const inventory = useQuery("tools.list", projectId ? { projectId } : {}, ["setup.changed"]);
  const [plan, setPlan] = useState<{ text: string; previews: ToolEditPreview[]; confirm: string }>();
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Row>();
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const available = projects.data?.filter((project) => !project.archived) ?? [];
  const rows = useMemo(() => rowsOf(inventory.data ?? []), [inventory.data]);

  const review = async (text: string, edits: ToolEdit[], confirm = "Apply"): Promise<void> => {
    setBusy(true);
    try {
      const previews: ToolEditPreview[] = [];
      for (const edit of edits) previews.push(await office.invoke("tools.preview", edit));
      setPlan({ text, previews, confirm });
      setAdding(false);
      setMoving(undefined);
    } catch (error) {
      notifyError(error, "Could not prepare the change", "tool-edit");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (): Promise<void> => {
    if (!plan) return;
    setBusy(true);
    try {
      for (const preview of plan.previews) await office.invoke("tools.apply", { id: preview.id });
      setPlan(undefined);
      inventory.reload();
      notifyDone("Saved", undefined, "tool-edit");
    } catch (error) {
      setPlan(undefined);
      notifyError(error, "Could not save the change", "tool-edit");
    } finally {
      setBusy(false);
    }
  };
  const edits = (row: Row, action: "disable" | "enable" | "remove"): ToolEdit[] =>
    row.entries.filter((entry) => action !== "enable" || entry.disabled).map((entry) => ({ action, id: entry.id, ...(projectId ? { projectId } : {}) }));
  const check = async (entry: ToolEntry): Promise<void> => {
    setChecks((value) => ({ ...value, [entry.id]: "Checking" }));
    try {
      const result = await office.invoke("tools.test", { id: entry.id, ...(projectId ? { projectId } : {}) });
      setChecks((value) => ({
        ...value,
        [entry.id]: result.ok ? `Connected, ${result.tools} ${result.tools === 1 ? "tool" : "tools"}` : (result.error ?? "Could not connect"),
      }));
    } catch (error) {
      setChecks((value) => ({ ...value, [entry.id]: error instanceof Error ? error.message : "Could not connect" }));
    }
  };

  return (
    <Page title="Tools" subtitle="What your agents can do, reach and run by themselves." testId="tools"
      primary={<Button variant="primary" onClick={() => setAdding(true)}><Plus /> Add</Button>}
    >
      <div className="flex gap-2">
        <Dropdown aria-label="Tools by project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Everywhere</option>
          {available.map((project) => <option key={project.id} value={project.id}>Everywhere and {project.name}</option>)}
        </Dropdown>
        <Button onClick={inventory.reload}>Refresh</Button>
      </div>
      {inventory.error && <Banner tone="danger">{inventory.error}</Banner>}
      {inventory.data?.length === 0 && <EmptyState title="Nothing is set up for your agents yet" />}
      {ToolGroup.options.map((group) => {
        const list = rows.filter((row) => row.group === group);
        if (!list.length) return null;
        return (
          <Card key={group} title={TOOL_GROUPS[group].title} testId={`tools-${group}`}>
            <p className="ui-muted pb-1">{TOOL_GROUPS[group].help}</p>
            {list.map((row) => {
              const on = isOn(row);
              const first = row.entries[0]!;
              const where = first.projectId ? available.find((project) => project.id === first.projectId)?.name ?? "One project" : "Everywhere";
              return (
                <div key={row.key} className="ui-line" data-testid="tool-row">
                  <div className="ui-line-main">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.title}</span>
                      {row.entries.map((entry) => <span key={entry.id} className="tool-agent" title={entry.disabled ? "Off" : "On"}>{PROGRAMS[entry.provider]}{row.entries.length > 1 && entry.disabled ? " (off)" : ""}</span>)}
                      <span className="ui-muted">{where}</span>
                    </div>
                    {row.description && <div className="ui-muted">{row.description}</div>}
                    <details className="pt-1">
                      <summary className="ui-line-sub cursor-pointer">Details</summary>
                      {row.entries.map((entry) => (
                        <dl key={entry.id} className="ui-dl pt-1">
                          <dt>Program</dt><dd>{PROGRAMS[entry.provider]}</dd>
                          <dt>File</dt><dd className="break-all">{entry.path}</dd>
                          {entry.configKey && <><dt>Setting</dt><dd className="break-all">{entry.configKey}</dd></>}
                          {entry.command && <><dt>Runs or connects to</dt><dd className="break-all">{entry.command}</dd></>}
                          {group === "connections" && <>
                            <dt>Check</dt>
                            <dd>
                              <Button size="sm" onClick={() => void check(entry)}>Check connection</Button>
                              {checks[entry.id] && <span className="pl-2" role="status">{checks[entry.id]}</span>}
                            </dd>
                          </>}
                        </dl>
                      ))}
                    </details>
                  </div>
                  <label className="flex items-center gap-2 py-1" title={on ? "Turn off" : "Turn on"}>
                    <input type="checkbox" role="switch" checked={on} aria-label={`${row.title}, ${on ? "on" : "off"}`}
                      disabled={busy || (!on && !row.entries.filter((entry) => entry.disabled).every(switchable))}
                      onChange={() => {
                        const action = on ? "disable" : "enable";
                        void review(sentence(action, action === "enable" ? { ...row, entries: row.entries.filter((entry) => entry.disabled) } : row, available), edits(row, action));
                      }} />
                    {on ? "On" : partly(row) ? "Partly on" : "Off"}
                  </label>
                  <OverflowMenu label={`Actions for ${row.title}`} items={[
                    { label: "Remove", onSelect: () => void review(sentence("remove", row, available), edits(row, "remove")) },
                    ...(row.entries.length === 1 && available.some((project) => project.id !== first.projectId)
                      ? [{ label: "Move to a project", onSelect: () => setMoving(row) }] : []),
                  ]} />
                </div>
              );
            })}
          </Card>
        );
      })}
      {adding && <AddTool projects={available} projectId={projectId} busy={busy} close={() => setAdding(false)}
        onReview={(text, edit) => review(text, [edit], "Add")} />}
      {moving && <MoveTool row={moving} projects={available.filter((project) => project.id !== moving.entries[0]?.projectId)}
        busy={busy} close={() => setMoving(undefined)}
        onMove={(destination) => review(sentence("move", moving, available, destination),
          [{ action: "move", id: moving.entries[0]!.id, destination, ...(projectId ? { projectId } : {}) }])} />}
      {plan && (
        <Dialog title="Confirm the change" onClose={() => { if (!busy) setPlan(undefined); }} footer={
          <>
            <Button disabled={busy} onClick={() => setPlan(undefined)}>Cancel</Button>
            <Button variant="primary" disabled={busy || plan.previews.every((preview) => !preview.changes.length)} onClick={() => void apply()}>{plan.confirm}</Button>
          </>
        }>
          <p>{plan.text}</p>
          <details className="pt-2">
            <summary className="cursor-pointer ui-label">Show the exact change</summary>
            {plan.previews.flatMap((preview) => preview.changes).map((edit, at) => (
              <section key={`${edit.path}${at}`} className="mt-2">
                <div className="ui-muted break-all">{edit.path}</div>
                <pre className="text-selectable whitespace-pre-wrap">{edit.diff}</pre>
              </section>
            ))}
          </details>
        </Dialog>
      )}
    </Page>
  );
}

function MoveTool({ row, projects, onMove, busy, close }: {
  row: Row; projects: Projects; onMove: (id: string) => Promise<void>; busy: boolean; close: () => void;
}) {
  const [target, setTarget] = useState(projects[0]?.id ?? "");
  return (
    <Dialog title={`Move ${row.title}`} onClose={close} footer={
      <><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={busy || !target} onClick={() => void onMove(target)}>Review the move</Button></>
    }>
      <Dropdown aria-label="Destination project" value={target} onChange={(event) => setTarget(event.target.value)}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Dropdown>
    </Dialog>
  );
}
