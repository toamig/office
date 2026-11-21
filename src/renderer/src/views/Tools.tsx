import { Plus } from "lucide-react";
import { useState } from "react";
import { ToolKind, ToolProvider, type ToolEdit, type ToolEditPreview, type ToolEntry } from "@shared/tool-config";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { Banner, Button, Card, Dialog, Dropdown, EmptyState, Group, Input, OverflowMenu, Page, notifyDone, notifyError } from "../ui";

const LABELS: Record<ToolKind, string> = {
  skill: "Skill", mcp: "MCP server", plugin: "Plugin", connector: "Connector", hook: "Hook",
};
const PROVIDERS: Record<ToolEntry["provider"], string> = { "claude-code": "Claude Code", codex: "Codex" };
type Projects = Array<{ id: string; name: string }>;

export function Tools() {
  const projects = useQuery("projects.list", undefined, ["workspace.changed"]);
  const [projectId, setProjectId] = useState("");
  const inventory = useQuery("tools.list", projectId ? { projectId } : {}, ["setup.changed"]);
  const [preview, setPreview] = useState<ToolEditPreview>();
  const [dialog, setDialog] = useState<"add" | ToolEntry>();
  const [busy, setBusy] = useState(false);
  const available = projects.data?.filter((project) => !project.archived) ?? [];

  const plan = async (change: ToolEdit): Promise<void> => {
    setBusy(true);
    try {
      setPreview(await office.invoke("tools.preview", change));
      setDialog(undefined);
    } catch (error) {
      notifyError(error, "Could not preview the tool change", "tool-edit");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (): Promise<void> => {
    if (!preview) return;
    setBusy(true);
    try {
      await office.invoke("tools.apply", { id: preview.id });
      setPreview(undefined);
      inventory.reload();
      notifyDone("Tool configuration saved", undefined, "tool-edit");
    } catch (error) {
      setPreview(undefined);
      notifyError(error, "Could not save the tool configuration", "tool-edit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Tools" testId="tools"
      primary={<Button variant="primary" onClick={() => setDialog("add")}><Plus /> Add tool</Button>}
    >
      <div className="flex gap-2">
        <Dropdown aria-label="Tools by project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">Global tools</option>
          {available.map((project) => <option key={project.id} value={project.id}>Global and {project.name}</option>)}
        </Dropdown>
        <Button onClick={inventory.reload}>Refresh</Button>
      </div>
      {inventory.error && <Banner tone="danger">{inventory.error}</Banner>}
      {inventory.data?.length === 0 && <EmptyState title="No tools configured" />}
      {ToolProvider.options.map((provider) => {
        const entries = inventory.data?.filter((entry) => entry.provider === provider);
        if (!entries?.length) return null;
        return (
          <Card key={provider} title={PROVIDERS[provider]}>
            {ToolKind.options.map((kind) => {
              const rows = entries.filter((entry) => entry.kind === kind);
              if (!rows.length) return null;
              return (
                <section key={kind}>
                  <Group>{LABELS[kind]}s</Group>
                  {rows.map((entry) => (
                    <div key={entry.id} className="ui-line">
                      <div className="ui-line-main">
                        <div>{entry.name}{entry.disabled ? " (disabled)" : ""}</div>
                        <div className="ui-line-sub break-all">{entry.path}</div>
                        {entry.detail && <div className="ui-line-sub break-all">{entry.detail}</div>}
                      </div>
                      <OverflowMenu label={`Actions for ${entry.name}`} items={[
                        { label: "Remove", onSelect: () => void plan({ action: "remove", id: entry.id, ...(projectId ? { projectId } : {}) }) },
                        ...(!entry.disabled ? [{ label: "Disable", onSelect: () => void plan({ action: "disable", id: entry.id, ...(projectId ? { projectId } : {}) }) }] : []),
                        ...(available.some((project) => project.id !== entry.projectId) ? [{ label: "Move to a project", onSelect: () => setDialog(entry) }] : []),
                      ]} />
                    </div>
                  ))}
                </section>
              );
            })}
          </Card>
        );
      })}
      {dialog === "add" && <AddTool projects={available} projectId={projectId} onPlan={plan} busy={busy} close={() => setDialog(undefined)} />}
      {dialog && dialog !== "add" && (
        <MoveTool
          entry={dialog}
          projects={available.filter((project) => project.id !== dialog.projectId)}
          onMove={(destination) => plan({ action: "move", id: dialog.id, destination, ...(projectId ? { projectId } : {}) })}
          busy={busy}
          close={() => setDialog(undefined)}
        />
      )}
      {preview && (
        <Dialog title="Review tool changes" wide onClose={() => setPreview(undefined)} footer={
          <>
            <Button disabled={busy} onClick={() => setPreview(undefined)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !preview.changes.length} onClick={() => void apply()}>Apply changes</Button>
          </>
        }>
          {preview.changes.map((edit) => (
            <section key={edit.path} className="mb-3">
              <Group>{edit.path}</Group>
              <pre className="text-selectable whitespace-pre-wrap">{edit.diff}</pre>
            </section>
          ))}
        </Dialog>
      )}
    </Page>
  );
}

function AddTool({ projects, projectId, onPlan, busy, close }: {
  projects: Projects; projectId: string; onPlan: (change: ToolEdit) => Promise<void>;
  busy: boolean; close: () => void;
}) {
  const [provider, setProvider] = useState<ToolEntry["provider"]>("claude-code");
  const [kind, setKind] = useState<ToolKind>("skill");
  const [scope, setScope] = useState(projectId);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const values: Partial<Record<ToolKind, string>> = { skill: "Skill folder", mcp: "Executable", connector: "Server address", hook: "Command" };
  return (
    <Dialog title="Add tool" onClose={close} footer={
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={busy || (kind !== "skill" && !name.trim()) || (kind !== "plugin" && !value.trim())}
          onClick={() => void onPlan({ action: "add", provider, kind, name, value, ...(scope ? { projectId: scope } : {}) })}>
          Review change
        </Button>
      </>
    }>
      <div className="grid gap-3">
        <Dropdown aria-label="Agent tool" value={provider} onChange={(event) => setProvider(ToolProvider.parse(event.target.value))}>
          {ToolProvider.options.map((item) => <option key={item} value={item}>{PROVIDERS[item]}</option>)}
        </Dropdown>
        <Dropdown aria-label="Tool type" value={kind} onChange={(event) => { setKind(ToolKind.parse(event.target.value)); setName(""); setValue(""); }}>
          {ToolKind.options.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}
        </Dropdown>
        <Dropdown aria-label="Tool location" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="">Global</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </Dropdown>
        {kind !== "skill" && <Input label={kind === "hook" ? "Hook event" : kind === "plugin" ? "Installed plugin ID" : "Name"} value={name} onChange={(event) => setName(event.target.value)} />}
        {kind !== "plugin" && <Input label={values[kind] ?? "Value"} value={value} onChange={(event) => setValue(event.target.value)} />}
        {kind === "skill" && <Button onClick={() => void office.invoke("setup.pickFolder", { title: "Choose the skill folder" }).then((folder) => { if (folder) setValue(folder); })}>Choose folder</Button>}
      </div>
    </Dialog>
  );
}

function MoveTool({ entry, projects, onMove, busy, close }: {
  entry: ToolEntry; projects: Projects; onMove: (id: string) => Promise<void>; busy: boolean; close: () => void;
}) {
  const [target, setTarget] = useState(projects[0]?.id ?? "");
  return (
    <Dialog title={`Move ${entry.name}`} onClose={close} footer={
      <><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={busy || !target} onClick={() => void onMove(target)}>Review move</Button></>
    }>
      <Dropdown aria-label="Destination project" value={target} onChange={(event) => setTarget(event.target.value)}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Dropdown>
    </Dialog>
  );
}
