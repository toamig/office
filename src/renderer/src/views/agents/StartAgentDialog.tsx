import { X } from "lucide-react";
import { useState } from "react";
import type { SessionRow } from "@shared/models";
import { Button, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

const NEW_WORKTREE = "__new_worktree__";
const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roles = Object.keys(workspace.data?.workspace?.roles ?? {});
  const provider = providers.data?.find((p) => p.id === providerId);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
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
      });
      onStarted(session);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      data-testid="start-agent-dialog"
    >
      <div
        className="w-[560px] rounded border"
        style={{ background: "var(--panel)", borderColor: "var(--line)" }}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <h2 className="m-0 text-sm font-semibold">Start an agent</h2>
          <Button variant="ghost" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </Button>
        </header>
        <div className="grid gap-3 p-4">
          {error && <ErrorBanner message={error} />}
          <label className="grid grid-cols-[110px_1fr] items-center gap-2">
            Project
            <select
              className={field}
              style={fieldStyle}
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
            </select>
          </label>
          <label className="grid grid-cols-[110px_1fr] items-center gap-2">
            Folder
            <select
              className={field}
              style={fieldStyle}
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
            </select>
          </label>
          {folder === NEW_WORKTREE && (
            <label className="grid grid-cols-[110px_1fr] items-center gap-2">
              Worktree name
              <input
                className={field}
                style={fieldStyle}
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
              <select
                className={field}
                style={fieldStyle}
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                data-testid="agent-role"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="grid grid-cols-[110px_1fr] items-center gap-2">
                Provider
                <select
                  className={field}
                  style={fieldStyle}
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
                </select>
              </label>
              <label className="grid grid-cols-[110px_1fr] items-center gap-2">
                Model
                <input
                  className={field}
                  style={fieldStyle}
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
              className={field}
              style={fieldStyle}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Optional. It is typed into the session once the tool is ready."
              data-testid="agent-prompt"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !project || (folder === NEW_WORKTREE && !newWorktree.trim())}
              onClick={() => void start()}
              data-testid="agent-start"
            >
              {busy ? "Starting..." : "Start"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
