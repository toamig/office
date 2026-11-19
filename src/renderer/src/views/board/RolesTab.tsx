import { Plus } from "lucide-react";
import { useState } from "react";
import { allProfiles } from "@shared/permissions";
import type { Role } from "@shared/types";
import { effortsFor, modelFits } from "@shared/roles";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import {
  Banner,
  Button,
  Card,
  Dialog,
  Dropdown,
  EmptyState,
  Input,
  LinkButton,
  SegmentedControl,
  StatusBadge,
  SplitPane,
  Textarea,
  notifyDone,
  notifyError,
  sentence,
} from "../../ui";

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Very high",
  max: "Max",
};

/** Starting points for a new role: what it is for, its standing instructions, and the profile it begins with. */
const TEMPLATES: Record<
  string,
  { label: string; purpose: string; instructions: string; profile: string; model?: string }
> = {
  blank: {
    label: "Blank",
    purpose: "",
    instructions: "",
    profile: "ask-first",
  },
  planner: {
    label: "Planner",
    purpose: "Turns a task into a plan and changes nothing.",
    instructions: "Plan only. Write the plan to the file you are given. Do not edit code.",
    profile: "plan-only",
    model: "opus",
  },
  builder: {
    label: "Builder",
    purpose: "Implements an approved plan and commits as it goes.",
    instructions: "Implement the approved plan exactly. Commit per step. Run the project's checks.",
    profile: "builder",
    model: "sonnet",
  },
  reviewer: {
    label: "Reviewer",
    purpose: "Reads a change against its plan and lists problems.",
    instructions: "Review the diff against the plan. List problems by severity with file and line.",
    profile: "reviewer",
  },
  tester: {
    label: "Tester",
    purpose: "Runs the checks and reports what fails.",
    instructions:
      "Run the project's tests and lint. Report each failure with the command that showed it.",
    profile: "reviewer",
  },
  researcher: {
    label: "Researcher",
    purpose: "Looks things up and summarises them with sources.",
    instructions: "Research and summarise with sources. Do not edit files.",
    profile: "read-only",
    model: "sonnet",
  },
  "docs-writer": {
    label: "Docs writer",
    purpose: "Writes and updates documentation.",
    instructions: "Write clear documentation for the change. Keep to the project's style.",
    profile: "builder",
  },
  artist: {
    label: "Artist",
    purpose: "Makes art briefs and asset lists.",
    instructions:
      "Write an art brief for the request: what it is, sizes, style, and where files go.",
    profile: "ask-first",
  },
};

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function RoleForm({
  id,
  role,
  onSaved,
  onRemoved,
  goTo,
}: {
  id: string;
  role: Role;
  onSaved: () => void;
  onRemoved: () => void;
  goTo: (tab: "pipelines" | "permissions") => void;
}) {
  const navigate = useUi((s) => s.navigate);
  const providers = useQuery("providers.list");
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [draft, setDraft] = useState<Role>(role);
  const profiles = allProfiles(workspace.data?.workspace?.permissionProfiles);
  const models = providers.data?.find((p) => p.id === draft.provider)?.models ?? [];
  const known = Object.fromEntries((providers.data ?? []).map((p) => [p.id, p.models]));
  const fits = modelFits(draft.provider, draft.model, known);
  const efforts = effortsFor(draft.provider);
  const profile = profiles.find((p) => p.id === draft.permissionProfile);
  const usedIn = Object.entries(workspace.data?.workspace?.pipelines ?? {}).flatMap(([pid, p]) =>
    p.stages.filter((s) => s.role === id).map((s) => ({ pid, name: p.name, stage: s.id })),
  );

  const set = <K extends keyof Role>(key: K, value: Role[K] | undefined): void =>
    setDraft((d) => {
      const next = { ...d } as Record<string, unknown>;
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next as unknown as Role;
    });

  const save = async (): Promise<void> => {
    try {
      await office.invoke("roles.save", {
        id,
        role: {
          provider: draft.provider,
          ...(draft.model ? { model: draft.model } : {}),
          ...(draft.effort ? { effort: draft.effort } : {}),
          instructions: draft.instructions,
          ...(draft.purpose ? { purpose: draft.purpose } : {}),
          permissionProfile: draft.permissionProfile ?? "ask-first",
          readOnly: false,
          allowedCommands: [],
        },
      });
      notifyDone("Role saved", "It is in the workspace config.", `role-${id}`);
      onSaved();
    } catch (err) {
      notifyError(err, "That role was not saved", "roles");
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await office.invoke("roles.remove", { id });
      onRemoved();
    } catch (err) {
      notifyError(err, "That role was not removed", "roles");
    }
  };

  return (
    <div className="grid content-start gap-4 p-4" data-testid="role-form">
      <div className="flex items-center gap-2">
        <h2 className="m-0 flex-1 text-[length:var(--text-lg)]">{sentence(id)}</h2>
        <Button
          onClick={() => navigate("agents", { start: "1", role: id })}
          data-testid="role-start-session"
        >
          Start a session as this role
        </Button>
      </div>
      <p className="ui-muted m-0">
        A pipeline stage names a role. When a task reaches that stage, Office starts this
        role&apos;s agent with its instructions and the stage&apos;s prompt, and the stage&apos;s
        output becomes the next stage&apos;s input.
      </p>
      <Input
        label="What this role is for"
        helper="One line, so the next person knows when to use it."
        value={draft.purpose ?? ""}
        onChange={(e) => set("purpose", e.target.value)}
        data-testid="role-purpose"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="ui-label">Provider</span>
          <Dropdown
            value={draft.provider}
            onChange={(e) =>
              setDraft((d) => {
                const next = { ...d, provider: e.target.value };
                // An effort the new provider does not accept is dropped; a model that does not fit is flagged.
                if (next.effort && !effortsFor(e.target.value).includes(next.effort))
                  delete next.effort;
                return next;
              })
            }
            data-testid="role-provider"
          >
            {(providers.data ?? []).map((p) => (
              <option key={p.id} value={p.id} disabled={!p.installed}>
                {p.label}
                {p.installed ? "" : " (not installed)"}
              </option>
            ))}
            {!providers.data?.some((p) => p.id === draft.provider) && (
              <option value={draft.provider}>{draft.provider}</option>
            )}
          </Dropdown>
          <span className="ui-helper">The command-line tool that does the work.</span>
        </label>
        <label className="grid gap-1">
          <span className="ui-label">Model</span>
          <Dropdown
            value={draft.model ?? ""}
            onChange={(e) => set("model", e.target.value)}
            data-testid="role-model"
          >
            <option value="">The tool&apos;s default</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {draft.model && !models.includes(draft.model) && (
              <option value={draft.model}>{draft.model} (not offered here)</option>
            )}
          </Dropdown>
          {fits ? (
            <span className="ui-helper">Which model the tool uses for this role.</span>
          ) : (
            <span className="ui-badges" data-testid="role-model-mismatch">
              <StatusBadge
                status="info"
                tone="attention"
                label="This model does not fit this provider"
              />
              <Button
                size="sm"
                onClick={() => set("model", undefined)}
                data-testid="role-model-fix"
              >
                Use the default model
              </Button>
            </span>
          )}
        </label>
      </div>
      <div className="grid gap-1">
        <span className="ui-label">Effort</span>
        <SegmentedControl
          label="Effort"
          value={draft.effort ?? ""}
          onChange={(v) => set("effort", (v || undefined) as Role["effort"])}
          options={[
            { value: "", label: "Default", testId: "role-effort-default" },
            ...efforts.map((value) => ({
              value,
              label: EFFORT_LABELS[value] ?? value,
              testId: `role-effort-${value}`,
            })),
          ]}
        />
        <span className="ui-helper">
          How hard the model thinks. More effort is slower and costs more.
        </span>
      </div>
      <label className="grid gap-1">
        <span className="ui-label">Permission profile</span>
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            value={draft.permissionProfile ?? ""}
            onChange={(e) => set("permissionProfile", e.target.value)}
            data-testid="role-profile"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Dropdown>
          <LinkButton onClick={() => goTo("permissions")} data-testid="role-edit-profiles">
            Edit profiles
          </LinkButton>
        </div>
        <span className="ui-helper" data-testid="role-profile-sentence">
          {profile?.description || "Pick what this role may do."}
        </span>
      </label>
      <Textarea
        label="Standing instructions"
        rows={5}
        value={draft.instructions}
        onChange={(e) => set("instructions", e.target.value)}
        placeholder="For example: Implement the approved plan exactly. Commit per step."
        data-testid="role-instructions"
      />
      <Card title="Used in" testId="role-used-in">
        {usedIn.length === 0 ? (
          <div data-testid="role-unused">
            <p className="ui-muted mt-0">No pipeline uses this role yet.</p>
            <div className="flex gap-2">
              <Button onClick={() => goTo("pipelines")} data-testid="role-add-to-pipeline">
                Add to a pipeline
              </Button>
            </div>
          </div>
        ) : (
          usedIn.map((u) => (
            <div key={`${u.pid}-${u.stage}`} className="ui-line" data-testid="role-used-row">
              <div className="ui-line-main">
                {u.name}
                <div className="ui-line-sub">Stage: {sentence(u.stage)}</div>
              </div>
            </div>
          ))
        )}
      </Card>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={() => void save()} data-testid="role-save">
          Save role
        </Button>
        <Button variant="danger" onClick={() => void remove()} data-testid="role-remove">
          Delete
        </Button>
      </div>
    </div>
  );
}

function NewRole({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("blank");
  const t = TEMPLATES[template] ?? (TEMPLATES["blank"] as (typeof TEMPLATES)[string]);
  const id = slug(name);
  const create = async (): Promise<void> => {
    try {
      await office.invoke("roles.save", {
        id,
        role: {
          provider: "claude-code",
          ...(t.model ? { model: t.model } : {}),
          instructions: t.instructions,
          ...(t.purpose ? { purpose: t.purpose } : {}),
          permissionProfile: t.profile,
          readOnly: false,
          allowedCommands: [],
        },
      });
      onCreated(id);
    } catch (err) {
      notifyError(err, "That role was not made", "roles");
    }
  };
  return (
    <Dialog
      title="New role"
      testId="new-role-dialog"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={id === ""}
            onClick={() => void create()}
            data-testid="new-role-create"
          >
            Make the role
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input
          label="Name"
          helper="Lowercase letters, digits and dashes are kept; the rest is turned into dashes."
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="new-role-id"
        />
        <label className="grid gap-1">
          <span className="ui-label">Start from</span>
          <Dropdown
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            data-testid="new-role-template"
          >
            {Object.entries(TEMPLATES).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </Dropdown>
          <span className="ui-helper">
            {t.purpose || "An empty role: you write its instructions."}
          </span>
        </label>
        <Banner tone="info">
          A pipeline stage names a role. When a task reaches that stage, Office starts that
          role&apos;s agent with its instructions and the stage&apos;s prompt.
        </Banner>
      </div>
    </Dialog>
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
      notifyError(err, "That override was not saved", "roles");
    }
  };
  return (
    <Card title="Project overrides" testId="panel-overrides">
      <p className="ui-muted mt-0">
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
            <span className="w-28">{sentence(role)}</span>
            <Dropdown
              value={overrides[role] ?? ""}
              onChange={(e) => void set(role, e.target.value || null)}
              aria-label={`Override for ${role}`}
              data-testid={`override-${role}`}
            >
              <option value="">Uses its own role</option>
              {roleIds
                .filter((r) => r !== role)
                .map((r) => (
                  <option key={r} value={r}>
                    Use {sentence(r)}
                  </option>
                ))}
            </Dropdown>
          </div>
        ))}
    </Card>
  );
}

/** Roles: who does a stage, on which model and with which permissions; set once, overridden per project. */
export function RolesTab({ goTo }: { goTo: (tab: "pipelines" | "permissions") => void }) {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const roles = workspace.data?.workspace?.roles ?? {};
  const ids = Object.keys(roles);
  const current = roles[selected] ? selected : ids[0];

  const list = (
    <div className="p-2" data-testid="role-list">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="ui-group m-0">Roles</h3>
        <Button size="sm" onClick={() => setCreating(true)} data-testid="new-role">
          <Plus /> New role
        </Button>
      </div>
      {ids.length === 0 && <EmptyState title="No roles yet">Make one with New role.</EmptyState>}
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
            <div className="ui-line-sub">{roles[id]?.purpose ?? roles[id]?.provider}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-0 flex-1" data-testid="roles-tab">
      <SplitPane
        id="roles"
        defaultSize={300}
        min={220}
        minSecond={460}
        first={list}
        second={
          <div className="grid content-start gap-4">
            {current && roles[current] ? (
              <RoleForm
                key={current}
                id={current}
                role={roles[current] as Role}
                onSaved={workspace.reload}
                onRemoved={() => setSelected("")}
                goTo={goTo}
              />
            ) : (
              <EmptyState title="No role">Pick one on the left.</EmptyState>
            )}
            <div className="px-4 pb-4">
              <Overrides roleIds={ids} />
            </div>
          </div>
        }
      />
      {creating && (
        <NewRole
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
            workspace.reload();
          }}
        />
      )}
    </div>
  );
}
