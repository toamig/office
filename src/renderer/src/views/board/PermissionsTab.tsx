import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  allProfiles,
  CLAUDE_MODES,
  CODEX_SANDBOXES,
  COMMAND_EXAMPLES,
  profileProblems,
  type NamedProfile,
} from "@shared/permissions";
import type { PermissionProfile } from "@shared/types";
import { useQuery } from "../../lib/hooks";
import { office } from "../../lib/ipc";
import {
  Button,
  Dropdown,
  EmptyState,
  Group,
  IconButton,
  Input,
  SplitPane,
  StatusBadge,
  notifyDone,
  notifyError,
} from "../../ui";

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const BLANK: PermissionProfile = {
  name: "",
  description: "",
  claudeMode: "default",
  codexSandbox: "workspace-write",
  allowedCommands: [],
  deniedCommands: [],
};

/** What a rule does, in words: an example's description, or "A rule of your own". */
const describeRule = (rule: string): string =>
  COMMAND_EXAMPLES.find((e) => e.rule === rule)?.description ?? "A rule of your own.";

/** A list of command rules, edited row by row, each with a plain description beside the raw rule. */
function RuleList({
  title,
  hint,
  rules,
  onChange,
  testId,
  readOnly,
}: {
  title: string;
  hint: string;
  rules: string[];
  onChange: (next: string[]) => void;
  testId: string;
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState("");
  const free = COMMAND_EXAMPLES.filter((e) => !rules.includes(e.rule));
  return (
    <section data-testid={testId}>
      <Group>{title}</Group>
      <p className="ui-muted mb-2 mt-0">{hint}</p>
      {rules.length === 0 && <p className="ui-muted m-0">None.</p>}
      {rules.map((rule, i) => (
        <div key={`${rule}-${i}`} className="ui-line" data-testid="rule-row">
          <div className="ui-line-main">
            <div>{describeRule(rule)}</div>
            {readOnly ? (
              <code className="ui-path">{rule}</code>
            ) : (
              <input
                className="mt-1 w-full font-mono"
                aria-label={`Rule ${i + 1}`}
                value={rule}
                onChange={(e) => onChange(rules.map((r, j) => (j === i ? e.target.value : r)))}
              />
            )}
          </div>
          {!readOnly && (
            <IconButton
              label={`Remove ${rule}`}
              size="sm"
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </IconButton>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Dropdown
            value={adding}
            aria-label={`Add an example to ${title}`}
            data-testid={`${testId}-example`}
            onChange={(e) => {
              if (e.target.value) onChange([...rules, e.target.value]);
              setAdding("");
            }}
          >
            <option value="">Add an example...</option>
            {free.map((e) => (
              <option key={e.rule} value={e.rule}>
                {e.label}
              </option>
            ))}
          </Dropdown>
          <Button size="sm" onClick={() => onChange([...rules, ""])}>
            <Plus /> Add a rule
          </Button>
        </div>
      )}
    </section>
  );
}

function ProfileEditor({
  profile,
  id,
  isNew,
  onSaved,
  onDuplicate,
  onDeleted,
}: {
  profile: NamedProfile | PermissionProfile;
  id: string;
  isNew: boolean;
  onSaved: (id: string) => void;
  onDuplicate: () => void;
  onDeleted: () => void;
}) {
  const builtIn = "builtIn" in profile && profile.builtIn;
  const [draft, setDraft] = useState<PermissionProfile>({
    name: profile.name,
    description: profile.description,
    ...(profile.claudeMode ? { claudeMode: profile.claudeMode } : {}),
    codexSandbox: profile.codexSandbox,
    allowedCommands: profile.allowedCommands,
    deniedCommands: profile.deniedCommands,
    ...(profile.confirmedUnsafe ? { confirmedUnsafe: true } : {}),
  });
  const set = (patch: Partial<PermissionProfile>): void => setDraft((d) => ({ ...d, ...patch }));
  const mode = CLAUDE_MODES.find((m) => m.id === (draft.claudeMode ?? "default"));
  const sandbox = CODEX_SANDBOXES.find((s) => s.id === draft.codexSandbox);
  const unsafe = Boolean(mode?.unsafe || sandbox?.unsafe);
  const problems = profileProblems(draft);

  const save = async (): Promise<void> => {
    const target = isNew ? slug(draft.name) : id;
    try {
      await office.invoke("profiles.save", {
        id: target,
        profile: {
          ...draft,
          allowedCommands: draft.allowedCommands.filter((r) => r.trim() !== ""),
          deniedCommands: draft.deniedCommands.filter((r) => r.trim() !== ""),
          ...(unsafe ? {} : { confirmedUnsafe: undefined }),
        },
      });
      notifyDone("Profile saved", draft.name, `profile-${target}`);
      onSaved(target);
    } catch (err) {
      notifyError(err, "That profile was not saved", `profile-${target}`);
    }
  };
  const remove = async (): Promise<void> => {
    try {
      await office.invoke("profiles.remove", { id });
      notifyDone("Profile removed", draft.name, `profile-${id}`);
      onDeleted();
    } catch (err) {
      notifyError(err, "That profile was not removed", `profile-${id}`);
    }
  };

  return (
    <div className="grid content-start gap-4 p-4" data-testid="profile-editor">
      <div className="flex items-center gap-2">
        <h2 className="m-0 flex-1 text-[length:var(--text-lg)]">
          {isNew ? "New profile" : profile.name}
        </h2>
        {builtIn && <StatusBadge status="info" label="Built in" />}
        {!isNew && (
          <Button onClick={onDuplicate} data-testid="profile-duplicate">
            <Copy /> Duplicate
          </Button>
        )}
      </div>
      {builtIn && (
        <p className="ui-muted m-0">
          A built-in profile cannot be changed. Duplicate it to make one of your own.
        </p>
      )}
      <Input
        label="Name"
        value={draft.name}
        disabled={builtIn}
        onChange={(e) => set({ name: e.target.value })}
        data-testid="profile-name"
      />
      <Input
        label="What agents using it may do"
        helper="One plain sentence."
        value={draft.description}
        disabled={builtIn}
        onChange={(e) => set({ description: e.target.value })}
        data-testid="profile-description"
      />
      <label className="grid gap-1">
        <span className="ui-label">Claude Code mode</span>
        <Dropdown
          value={draft.claudeMode ?? "default"}
          disabled={builtIn}
          data-testid="profile-claude-mode"
          onChange={(e) => set({ claudeMode: e.target.value as PermissionProfile["claudeMode"] })}
        >
          {CLAUDE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.unsafe ? " (needs your confirmation)" : ""}
            </option>
          ))}
        </Dropdown>
        <span className="ui-helper">{mode?.description}</span>
      </label>
      <label className="grid gap-1">
        <span className="ui-label">Codex sandbox</span>
        <Dropdown
          value={draft.codexSandbox}
          disabled={builtIn}
          data-testid="profile-sandbox"
          onChange={(e) =>
            set({ codexSandbox: e.target.value as PermissionProfile["codexSandbox"] })
          }
        >
          {CODEX_SANDBOXES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.unsafe ? " (needs your confirmation)" : ""}
            </option>
          ))}
        </Dropdown>
        <span className="ui-helper">{sandbox?.description}</span>
      </label>
      {unsafe && !builtIn && (
        <label className="ui-ask flex items-start gap-2" data-testid="profile-unsafe">
          <input
            type="checkbox"
            checked={draft.confirmedUnsafe === true}
            onChange={(e) => set({ confirmedUnsafe: e.target.checked })}
            data-testid="profile-unsafe-ok"
          />
          <span>
            I understand. This lets an agent change or delete anything the account can, without
            asking. Without this the profile runs with the safe choice instead.
          </span>
        </label>
      )}
      <RuleList
        title="Allowed commands"
        hint="An agent may run these without asking. Claude Code only: Codex roles run in Codex's own sandbox and ignore them."
        rules={draft.allowedCommands}
        onChange={(allowedCommands) => set({ allowedCommands })}
        testId="profile-allowed"
        readOnly={builtIn}
      />
      <RuleList
        title="Denied commands"
        hint="An agent may never run these, even when the mode would let it."
        rules={draft.deniedCommands}
        onChange={(deniedCommands) => set({ deniedCommands })}
        testId="profile-denied"
        readOnly={builtIn}
      />
      {!builtIn && problems.length > 0 && <p className="ui-warn m-0">{problems[0]}</p>}
      {!builtIn && (
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={problems.length > 0 || (isNew && slug(draft.name) === "")}
            onClick={() => void save()}
            data-testid="profile-save"
          >
            Save profile
          </Button>
          {!isNew && (
            <Button variant="danger" onClick={() => void remove()} data-testid="profile-delete">
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Permission profiles: what agents may do, named once and given to roles. */
export function PermissionsTab() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const custom = workspace.data?.workspace?.permissionProfiles;
  const profiles = allProfiles(custom);
  const roles = workspace.data?.workspace?.roles ?? {};
  const [selected, setSelected] = useState("");
  const [fresh, setFresh] = useState<PermissionProfile | null>(null);
  const current = fresh ? null : (profiles.find((p) => p.id === selected) ?? profiles[0]);
  const usedBy = (id: string): string[] =>
    Object.entries(roles)
      .filter(([, r]) => r.permissionProfile === id)
      .map(([rid]) => rid);

  const list = (
    <div className="p-2" data-testid="profile-list">
      <div className="mb-2 flex items-center justify-between">
        <Group>Profiles</Group>
        <Button size="sm" onClick={() => setFresh({ ...BLANK })} data-testid="new-profile">
          <Plus /> New profile
        </Button>
      </div>
      {profiles.map((p) => (
        <div
          key={p.id}
          className="ui-row"
          role="button"
          tabIndex={0}
          data-clickable="true"
          data-testid="profile-row"
          data-selected={!fresh && current?.id === p.id ? "true" : undefined}
          onClick={() => {
            setFresh(null);
            setSelected(p.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setFresh(null);
              setSelected(p.id);
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">{p.name}</div>
            <div className="ui-line-sub">{p.description || "No description."}</div>
            <div className="ui-line-sub">
              {p.builtIn ? "Built in. " : ""}
              {usedBy(p.id).length > 0 ? `Used by ${usedBy(p.id).join(", ")}` : "Used by no role"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-0 flex-1" data-testid="permissions-tab">
      <SplitPane
        id="permissions"
        defaultSize={380}
        min={260}
        minSecond={420}
        first={list}
        second={
          fresh ? (
            <ProfileEditor
              key="new"
              profile={fresh}
              id=""
              isNew
              onSaved={(id) => {
                setFresh(null);
                setSelected(id);
              }}
              onDuplicate={() => undefined}
              onDeleted={() => setFresh(null)}
            />
          ) : current ? (
            <ProfileEditor
              key={current.id}
              profile={current}
              id={current.id}
              isNew={false}
              onSaved={setSelected}
              onDuplicate={() =>
                setFresh({
                  name: `${current.name} copy`,
                  description: current.description,
                  ...(current.claudeMode ? { claudeMode: current.claudeMode } : {}),
                  codexSandbox: current.codexSandbox,
                  allowedCommands: [...current.allowedCommands],
                  deniedCommands: [...current.deniedCommands],
                })
              }
              onDeleted={() => setSelected("")}
            />
          ) : (
            <EmptyState title="No profile">Pick one on the left.</EmptyState>
          )
        }
      />
    </div>
  );
}
