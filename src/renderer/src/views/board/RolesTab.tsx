import { useState } from "react";
import type { Role } from "@shared/types";
import { Button, Card, Dropdown, EmptyState, notifyDone, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

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
  const models = providers.data?.find((p) => p.id === draft.provider)?.models ?? [];

  const save = async (): Promise<void> => {
    try {
      await office.invoke("roles.save", { id, role: draft });
      notifyDone("Role saved", "It is in the workspace config.", `role-${id}`);
      onSaved();
    } catch (err) {
      notifyError(err, "That did not work", "roles");
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await office.invoke("roles.remove", { id });
      onRemoved();
    } catch (err) {
      notifyError(err, "That did not work", "roles");
    }
  };
  const set = <K extends keyof Role>(key: K, value: Role[K] | undefined): void => {
    setDraft((d) => {
      const next = { ...d } as Record<string, unknown>;
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next as unknown as Role;
    });
  };

  return (
    <div className="grid gap-2.5" data-testid="role-form">
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Provider
        <Dropdown
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
        </Dropdown>
      </label>
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Model
        <input
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
        <Dropdown
          value={draft.effort ?? ""}
          onChange={(e) => set("effort", (e.target.value || undefined) as Role["effort"])}
          data-testid="role-effort"
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e || "provider default"}
            </option>
          ))}
        </Dropdown>
      </label>
      <label className="grid grid-cols-[130px_1fr] items-center gap-2">
        Permission mode
        <input
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
          <span className="block text-[length:var(--text-xs)] ui-muted">
            one rule per line, for example Bash(git commit:*). Claude Code only: Codex roles run in
            Codex&apos;s own sandbox and ignore this.
          </span>
        </span>
        <textarea
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
      </div>
    </div>
  );
}

function Overrides({ roleIds }: { roleIds: string[] }) {
  const projects = useQuery("projects.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [projectId, setProjectId] = useState("");
  const overrides =
    workspace.data?.workspace?.projects.find((p) => p.id === projectId)?.roles ?? {};

  const set = async (role: string, target: string | null): Promise<void> => {
    try {
      await office.invoke("roles.setOverride", { projectId, role, target });
    } catch (err) {
      notifyError(err, "That did not work", "roles");
    }
  };
  return (
    <Card title="Project overrides">
      <p className="mt-0 text-[length:var(--text-sm)] ui-muted">
        A project can use another role whenever a pipeline or the Start agent dialog asks for one,
        for example a project whose builder is Codex.
      </p>
      <Dropdown
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label="Override project"
        data-testid="override-project"
      >
        <option value="">Choose a project</option>
        {(projects.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Dropdown>
      {projectId &&
        roleIds.map((role) => (
          <div key={role} className="mt-2 flex items-center gap-2">
            <span className="w-28">{role}</span>
            <Dropdown
              value={overrides[role] ?? ""}
              onChange={(e) => void set(role, e.target.value || null)}
              aria-label={`Override for ${role}`}
              data-testid={`override-${role}`}
            >
              <option value="">uses its own role</option>
              {roleIds
                .filter((r) => r !== role)
                .map((r) => (
                  <option key={r} value={r}>
                    use {r}
                  </option>
                ))}
            </Dropdown>
          </div>
        ))}
    </Card>
  );
}

/** Roles: provider, model, effort and standing instructions per role; set once, overridden per project. */
export function RolesTab() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [selected, setSelected] = useState("");
  const [newId, setNewId] = useState("");
  const roles = workspace.data?.workspace?.roles ?? {};
  const ids = Object.keys(roles);
  const current = roles[selected] ? selected : ids[0];

  const create = async (): Promise<void> => {
    try {
      await office.invoke("roles.save", {
        id: newId.trim(),
        role: { provider: "claude-code", instructions: "", readOnly: false, allowedCommands: [] },
      });
      setSelected(newId.trim());
      setNewId("");
    } catch (err) {
      notifyError(err, "That did not work", "roles");
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]" data-testid="roles-tab">
      <div>
        {ids.length === 0 && <EmptyState title="No roles yet">Add one below.</EmptyState>}
        {ids.map((id) => (
          <div
            key={id}
            data-testid="role-row"
            className="ui-row"
            role="button"
            tabIndex={0}
            data-clickable="true"
            data-selected={current === id ? "true" : undefined}
            onClick={() => setSelected(id)}
            onKeyDown={(e) => e.key === "Enter" && setSelected(id)}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{id}</div>
              <div className="ui-line-sub">
                {roles[id]?.provider} {roles[id]?.model ?? ""}
              </div>
            </div>
          </div>
        ))}
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
            className="min-w-0 flex-1"
          />
          <Button type="submit" disabled={!newId.trim()} data-testid="new-role">
            Add
          </Button>
        </form>
      </div>
      <div className="grid content-start gap-4">
        {current && roles[current] && (
          <Card title={`Role: ${current}`}>
            <RoleForm
              key={current}
              id={current}
              role={roles[current] as Role}
              onSaved={workspace.reload}
              onRemoved={() => setSelected("")}
            />
          </Card>
        )}
        <Overrides roleIds={ids} />
      </div>
    </div>
  );
}
