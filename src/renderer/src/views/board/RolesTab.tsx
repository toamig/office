import { useState } from "react";
import type { Role } from "@shared/types";
import { Button, Chip, EmptyState, ErrorBanner, Panel } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { Select } from "../../components/Select";

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;

function RoleForm({
  id,
  role,
  onSaved,
  onRemoved,
}: {
  id: string;
  role: Role;
  onSaved: () => void;
  onRemoved: () => void;
}) {
  const providers = useQuery("providers.list");
  const [draft, setDraft] = useState<Role>(role);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const models = providers.data?.find((p) => p.id === draft.provider)?.models ?? [];

  const save = async (): Promise<void> => {
    setError(null);
    setSaved(false);
    try {
      await office.invoke("roles.save", { id, role: draft });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (): Promise<void> => {
    setError(null);
    try {
      await office.invoke("roles.remove", { id });
      onRemoved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const set = <K extends keyof Role>(key: K, value: Role[K] | undefined): void => {
    setSaved(false);
    setDraft((d) => {
      const next = { ...d } as Record<string, unknown>;
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next as unknown as Role;
    });
  };

  return (
    <div className="grid gap-2.5" data-testid="role-form">
      {error && (
        <div data-testid="role-error">
          <ErrorBanner message={error} />
        </div>
      )}
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Provider
        <Select
          className={field}
          style={fieldStyle}
          value={draft.provider}
          onChange={(e) => set("provider", e.target.value)}
          data-testid="role-provider"
        >
          {(providers.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {!providers.data?.some((p) => p.id === draft.provider) && (
            <option value={draft.provider}>{draft.provider}</option>
          )}
        </Select>
      </label>
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Model
        <input
          className={field}
          style={fieldStyle}
          list="role-models"
          value={draft.model ?? ""}
          placeholder="provider default"
          onChange={(e) => set("model", e.target.value)}
          data-testid="role-model"
        />
        <datalist id="role-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Effort
        <Select
          className={field}
          style={fieldStyle}
          value={draft.effort ?? ""}
          onChange={(e) => set("effort", (e.target.value || undefined) as Role["effort"])}
          data-testid="role-effort"
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e || "provider default"}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Permission mode
        <input
          className={field}
          style={fieldStyle}
          value={draft.permissionMode ?? ""}
          placeholder="for example: plan"
          onChange={(e) => set("permissionMode", e.target.value)}
        />
      </label>
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Read only
        <input
          type="checkbox"
          checked={draft.readOnly}
          onChange={(e) => set("readOnly", e.target.checked)}
        />
      </label>
      <label className="grid grid-cols-[130px_1fr] items-start gap-2">
        <span>
          Allowed commands
          <span className="block text-[12px]" style={{ color: "var(--muted)" }}>
            one rule per line, for example Bash(git commit:*). Claude Code only: Codex roles run in
            Codex&apos;s own sandbox and ignore this.
          </span>
        </span>
        <textarea
          className={field}
          style={fieldStyle}
          rows={5}
          value={draft.allowedCommands.join("\n")}
          onChange={(e) =>
            set(
              "allowedCommands",
              e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            )
          }
          data-testid="role-allowed-commands"
        />
      </label>
      <label className="grid grid-cols-[130px_1fr] items-start gap-2">
        Instructions
        <textarea
          className={field}
          style={fieldStyle}
          rows={5}
          value={draft.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          data-testid="role-instructions"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={() => void save()} data-testid="role-save">
          Save role
        </Button>
        <Button onClick={() => void remove()} data-testid="role-remove">
          Delete
        </Button>
        {saved && <Chip tone="good">Saved to the workspace config</Chip>}
      </div>
    </div>
  );
}

function Overrides({ roleIds }: { roleIds: string[] }) {
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const overrides =
    workspace.data?.workspace?.projects.find((p) => p.id === projectId)?.roles ?? {};

  const set = async (role: string, target: string | null): Promise<void> => {
    setError(null);
    try {
      await office.invoke("roles.setOverride", { projectId, role, target });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Panel title="Project overrides">
      <p className="mt-0 text-[12.5px]" style={{ color: "var(--muted)" }}>
        A project can use another role whenever a pipeline or the Start agent dialog asks for one,
        for example a project whose builder is Codex.
      </p>
      {error && <ErrorBanner message={error} />}
      <Select
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label="Override project"
        data-testid="override-project"
        className={field}
        style={fieldStyle}
      >
        <option value="">Choose a project</option>
        {(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {projectId &&
        roleIds.map((role) => (
          <div key={role} className="mt-2 flex items-center gap-2">
            <span className="w-28">{role}</span>
            <Select
              value={overrides[role] ?? ""}
              onChange={(e) => void set(role, e.target.value || null)}
              aria-label={`Override for ${role}`}
              data-testid={`override-${role}`}
              className={field}
              style={fieldStyle}
            >
              <option value="">uses its own role</option>
              {roleIds
                .filter((r) => r !== role)
                .map((r) => (
                  <option key={r} value={r}>
                    use {r}
                  </option>
                ))}
            </Select>
          </div>
        ))}
    </Panel>
  );
}

/** Roles: provider, model, effort and standing instructions per role; set once, overridden per project. */
export function RolesTab() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [selected, setSelected] = useState("");
  const [newId, setNewId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const roles = workspace.data?.workspace?.roles ?? {};
  const ids = Object.keys(roles);
  const current = roles[selected] ? selected : ids[0];

  const create = async (): Promise<void> => {
    setError(null);
    try {
      await office.invoke("roles.save", {
        id: newId.trim(),
        role: { provider: "claude-code", instructions: "", readOnly: false, allowedCommands: [] },
      });
      setSelected(newId.trim());
      setNewId("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]" data-testid="roles-tab">
      <div>
        {ids.length === 0 && <EmptyState>No roles yet. Add one below.</EmptyState>}
        {ids.map((id) => (
          <div
            key={id}
            data-testid="role-row"
            onClick={() => setSelected(id)}
            className="rounded border px-3 py-2"
            style={{
              marginBottom: 4,
              borderColor: "var(--line)",
              background: current === id ? "var(--panel)" : "transparent",
            }}
          >
            <div className="font-medium">{id}</div>
            <div className="text-[12px]" style={{ color: "var(--muted)" }}>
              {roles[id]?.provider} {roles[id]?.model ?? ""}
            </div>
          </div>
        ))}
        {error && <ErrorBanner message={error} />}
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="new-role-id"
            aria-label="New role id"
            data-testid="new-role-id"
            className={`${field} min-w-0 flex-1`}
            style={fieldStyle}
          />
          <Button type="submit" disabled={!newId.trim()} data-testid="new-role">
            Add
          </Button>
        </form>
      </div>
      <div className="grid content-start gap-4">
        {current && roles[current] && (
          <Panel title={`Role: ${current}`}>
            <RoleForm
              key={current}
              id={current}
              role={roles[current] as Role}
              onSaved={workspace.reload}
              onRemoved={() => setSelected("")}
            />
          </Panel>
        )}
        <Overrides roleIds={ids} />
      </div>
    </div>
  );
}
