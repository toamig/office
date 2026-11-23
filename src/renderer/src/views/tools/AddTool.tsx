import { useEffect, useState } from "react";
import type { InstalledPlugin, ToolEdit, ToolEntry, ToolTestResult } from "@shared/tool-config";
import { office } from "../../lib/ipc";
import { Banner, Button, Dialog, Dropdown, Input, SegmentedControl } from "../../ui";

type What = "skill" | "connection" | "plugin";
type Mode = "address" | "command";
const PROGRAMS: Record<ToolEntry["provider"], string> = { "claude-code": "Claude Code", codex: "Codex" };

function nameFor(value: string, mode: Mode): string {
  if (mode === "address") {
    try { return new URL(value).hostname.replace(/^(www|mcp|api)\./, "").split(".")[0] ?? ""; } catch { return ""; }
  }
  const last = value.trim().split(/\s+/).filter((part) => !part.startsWith("-")).pop() ?? "";
  return (last.split(/[\\/]/).pop() ?? "").replace(/^@[^/]+\//, "").replace(/\.\w+$/, "").replace(/[^A-Za-z0-9_.-]/g, "-");
}

/** Add a skill from a folder, a connection from an address or a command (tried first), or a plugin from the installed list. */
export function AddTool({ projects, projectId, busy, close, onReview }: {
  projects: Array<{ id: string; name: string }>;
  projectId: string;
  busy: boolean;
  close: () => void;
  onReview: (text: string, edit: ToolEdit) => Promise<void>;
}) {
  const [what, setWhat] = useState<What>("skill");
  const [provider, setProvider] = useState<ToolEntry["provider"]>("claude-code");
  const [scope, setScope] = useState(projectId);
  const [folder, setFolder] = useState("");
  const [mode, setMode] = useState<Mode>("address");
  const [value, setValue] = useState("");
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const [test, setTest] = useState<ToolTestResult | "running" | null>(null);
  const [skipTest, setSkipTest] = useState(false);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [plugin, setPlugin] = useState("");
  useEffect(() => {
    if (what !== "plugin") return;
    void office.invoke("tools.plugins", { provider, ...(scope ? { projectId: scope } : {}) }).then((list) => {
      setPlugins(list);
      setPlugin(list[0]?.id ?? "");
    }).catch(() => setPlugins([]));
  }, [what, provider, scope]);

  const where = scope ? projects.find((project) => project.id === scope)?.name ?? "one project" : "everywhere";
  const result = test !== null && test !== "running" ? test : null;
  const connected = result?.ok === true;
  const base = { provider, ...(scope ? { projectId: scope } : {}) };
  const runTest = async (): Promise<void> => {
    setTest("running");
    try {
      setTest(await office.invoke("tools.test", mode === "address" ? { address: value } : { command: value }));
    } catch (error) {
      setTest({ ok: false, tools: 0, server: null, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const ready = what === "skill" ? Boolean(folder)
    : what === "plugin" ? Boolean(plugin)
      : Boolean(value.trim() && name.trim()) && (connected || skipTest);
  const review = (): void => {
    if (what === "skill") {
      const skill = folder.split(/[\\/]/).filter(Boolean).pop() ?? "skill";
      void onReview(`Add the ${skill} skill to ${PROGRAMS[provider]}, ${where}.`, { action: "add", kind: "skill", name: "", value: folder, ...base });
    } else if (what === "plugin") {
      void onReview(`Turn on the ${plugin.split("@")[0]} plugin for ${PROGRAMS[provider]}, ${where}.`, { action: "add", kind: "plugin", name: plugin, value: "", ...base });
    } else {
      void onReview(`Add the ${name} connection to ${PROGRAMS[provider]}, ${where}.`,
        { action: "add", kind: mode === "address" ? "connector" : "mcp", name: name.trim(), value: value.trim(), ...base });
    }
  };

  return (
    <Dialog title="Add to your agents" onClose={close} footer={
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={busy || !ready} onClick={review}>Review the change</Button>
      </>
    }>
      <div className="grid gap-3">
        <SegmentedControl label="What to add" value={what} onChange={(next) => { setWhat(next); setTest(null); }}
          options={[{ value: "skill", label: "Skill" }, { value: "connection", label: "Connection" }, { value: "plugin", label: "Plugin" }]} />
        <label className="grid gap-1">
          <span className="ui-label">For</span>
          <Dropdown aria-label="Agent program" value={provider} onChange={(event) => setProvider(event.target.value === "codex" ? "codex" : "claude-code")}>
            <option value="claude-code">Claude Code</option>
            {what !== "plugin" && <option value="codex">Codex</option>}
          </Dropdown>
        </label>
        <label className="grid gap-1">
          <span className="ui-label">Where it applies</span>
          <Dropdown aria-label="Where it applies" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">Everywhere</option>
            {projects.map((project) => <option key={project.id} value={project.id}>Only {project.name}</option>)}
          </Dropdown>
        </label>
        {what === "skill" && <div className="grid gap-1">
          <p className="ui-muted">A skill is a folder with a SKILL.md file. Pick the folder; Office copies it in.</p>
          <div className="flex items-center gap-2">
            <Button onClick={() => void office.invoke("setup.pickFolder", { title: "Choose the skill folder" }).then((picked) => { if (picked) setFolder(picked); })}>Choose folder</Button>
            {folder && <span>{folder.split(/[\\/]/).filter(Boolean).pop()}</span>}
          </div>
        </div>}
        {what === "connection" && <>
          <SegmentedControl label="How it connects" value={mode} onChange={(next) => { setMode(next); setTest(null); setValue(""); }}
            options={[{ value: "address", label: "A web address" }, { value: "command", label: "A program on this computer" }]} />
          <Input label={mode === "address" ? "Address" : "Command"} value={value}
            placeholder={mode === "address" ? "https://example.com/mcp" : "npx -y some-server"}
            onChange={(event) => {
              setValue(event.target.value); setTest(null); setSkipTest(false);
              if (!named) setName(nameFor(event.target.value, mode));
            }} />
          <Input label="Name" value={name} onChange={(event) => { setName(event.target.value); setNamed(true); }}
            helper="Letters, numbers, dots and hyphens." />
          <div className="flex items-center gap-2">
            <Button disabled={!value.trim() || test === "running"} onClick={() => void runTest()}>Test the connection</Button>
            {test === "running" && <span className="ui-muted" role="status">Connecting</span>}
            {result?.ok && <span role="status">Connected, {result.tools} {result.tools === 1 ? "tool" : "tools"}{result.server ? ` (${result.server})` : ""}</span>}
          </div>
          {result && !result.ok && <Banner tone="danger">
            {result.error ?? "Could not connect."}
            <label className="flex items-center gap-2 pt-1">
              <input type="checkbox" checked={skipTest} onChange={(event) => setSkipTest(event.target.checked)} /> Add it anyway
            </label>
          </Banner>}
        </>}
        {what === "plugin" && (plugins.length === 0
          ? <p className="ui-muted">Every installed plugin is already on for this program, or none is installed.</p>
          : <Dropdown aria-label="Installed plugin" value={plugin} onChange={(event) => setPlugin(event.target.value)}>
            {plugins.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}{entry.description ? `: ${entry.description.slice(0, 70)}` : ""}</option>)}
          </Dropdown>)}
      </div>
    </Dialog>
  );
}
