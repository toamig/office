import { useState } from "react";
import type { SessionRow } from "@shared/models";
import { Button, Dialog, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Dropdown as Select } from "../../ui";

const NEW_WORKTREE = "__new_worktree__";

/** Start an agent: pick the project, a role or a provider and model, then an optional first prompt. */
export function StartAgentDialog({
  projectId,
  cwd,
  onClose,
  onStarted,
}: {
  projectId?: string;
  cwd?: string;
  onClose: () => void;
  onStarted: (session: SessionRow) => void;
}) {
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get");
  const providers = useQuery("providers.list");
  const [project, setProject] = useState(projectId ?? "");
  const [folder, setFolder] = useState(cwd ?? "");
  const [newWorktree, setNewWorktree] = useState("");
  const worktrees = useQuery("worktrees.list", { projectId: project || "__none__" });
  const [mode, setMode] = useState<"role" | "provider">("role");
  const [roleId, setRoleId] = useState("builder");
  const [providerId, setProviderId] = useState("claude-code");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  // Chat or terminal: the machine's last choice, remembered when it is changed here.
  const settings = useQuery("settings.get");
  const [picked, setPicked] = useState<"chat" | "terminal" | null>(null);
  const sessionMode = picked ?? settings.data?.sessionMode ?? "chat";

  const roles = Object.keys(workspace.data?.workspace?.roles ?? {});
  const provider = providers.data?.find((p) => p.id === providerId);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      let where = folder;
      if (folder === NEW_WORKTREE) {
        const made = await office.invoke("worktrees.create", {
          projectId: project,
          name: newWorktree.trim(),
        });
        where = made.path;
      }
      const session = await office.invoke("sessions.start", {
        ...(project ? { projectId: project } : {}),
        ...(where ? { cwd: where } : {}),
        ...(mode === "role" ? { roleId } : { providerId, ...(model ? { model } : {}) }),
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        mode: sessionMode,
      });
      onStarted(session);
    } catch (err) {
      notifyError(err, "Could not start the agent", "start-agent");
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Start an agent"
      testId="start-agent-dialog"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !project || (folder === NEW_WORKTREE && !newWorktree.trim())}
            onClick={() => void start()}
            data-testid="agent-start"
          >
            {busy ? "Starting..." : "Start"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex items-center gap-4" data-testid="agent-mode">
          <span className="w-28">Open as</span>
          {(["chat", "terminal"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                name="session-mode"
                checked={sessionMode === m}
                onChange={() => {
                  setPicked(m);
                  void office.invoke("settings.set", { sessionMode: m });
                }}
                data-testid={`mode-${m}`}
              />{" "}
              {m === "chat" ? "Chat" : "Terminal"}
            </label>
          ))}
        </div>
        <label className="grid grid-cols-[110px_1fr] items-center gap-2">
          Project
          <Select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            data-testid="agent-project"
          >
            <option value="">Choose a project</option>
            {(projects.data ?? [])
              .filter((p) => !p.archived && p.exists)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </label>
        <label className="grid grid-cols-[110px_1fr] items-center gap-2">
          Folder
          <Select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            data-testid="agent-folder"
          >
            <option value="">Project folder</option>
            {(worktrees.data ?? [])
              .filter((w) => w.kind !== "main")
              .map((w) => (
                <option key={w.path} value={w.path}>
                  Worktree: {w.branch ?? w.path}
                </option>
              ))}
            <option value={NEW_WORKTREE}>New worktree...</option>
          </Select>
        </label>
        {folder === NEW_WORKTREE && (
          <label className="grid grid-cols-[110px_1fr] items-center gap-2">
            Worktree name
            <input
              value={newWorktree}
              placeholder="for example: fix login bug"
              onChange={(e) => setNewWorktree(e.target.value)}
              data-testid="agent-new-worktree"
            />
          </label>
        )}
        <div className="grid grid-cols-[110px_1fr] items-center gap-2">
          Run as
          <div className="flex gap-4">
            <label>
              <input type="radio" checked={mode === "role"} onChange={() => setMode("role")} /> A
              role
            </label>
            <label>
              <input
                type="radio"
                checked={mode === "provider"}
                onChange={() => setMode("provider")}
                data-testid="mode-provider"
              />{" "}
              A provider
            </label>
          </div>
        </div>
        {mode === "role" ? (
          <label className="grid grid-cols-[110px_1fr] items-center gap-2">
            Role
            <Select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              data-testid="agent-role"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <>
            <label className="grid grid-cols-[110px_1fr] items-center gap-2">
              Provider
              <Select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                data-testid="agent-provider"
              >
                {(providers.data ?? []).map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.installed}>
                    {p.label}
                    {p.installed ? "" : " (not installed)"}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid grid-cols-[110px_1fr] items-center gap-2">
              Model
              <input
                list="agent-models"
                value={model}
                placeholder="tool default"
                onChange={(e) => setModel(e.target.value)}
                data-testid="agent-model"
              />
              <datalist id="agent-models">
                {(provider?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </>
        )}
        <label className="grid grid-cols-[110px_1fr] items-start gap-2">
          First prompt
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional. It is typed into the session once the tool is ready."
            data-testid="agent-prompt"
          />
        </label>
      </div>
    </Dialog>
  );
}
