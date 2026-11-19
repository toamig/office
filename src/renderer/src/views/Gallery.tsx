import { Plus, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { STATUS } from "@shared/tone";
import {
  Banner,
  Button,
  Card,
  CountPill,
  Dialog,
  Dropdown,
  EmptyState,
  IconButton,
  Input,
  Kbd,
  ListRow,
  notify,
  PathField,
  SegmentedControl,
  Skeleton,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
} from "../ui";

const TOKENS = [
  "bg",
  "raised",
  "overlay",
  "hover",
  "selected",
  "line",
  "text",
  "muted",
  "faint",
  "accent",
  "success",
  "info",
  "attention",
  "danger",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8" data-testid={`gallery-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <h2 className="mb-3 mt-0 text-[length:var(--text-lg)] font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

const SCALE: Array<[string, string]> = [
  ["--text-2xl", "View title, 24"],
  ["--text-xl", "Section title, 20"],
  ["--text-lg", "Dialog title, 16"],
  ["--text-md", "Body text, 14"],
  ["--text-sm", "Secondary text, 13"],
  ["--text-xs", "Captions and badges, 12"],
];

const ROWS = [
  { id: "a", name: "Alpha", status: "up-to-date", count: 4 },
  { id: "b", name: "Beta", status: "behind", count: 11 },
  { id: "c", name: "Gamma", status: "failed", count: 2 },
];

/** Every component of the design system, in every state. */
export function Gallery() {
  const [tab, setTab] = useState("one");
  const [seg, setSeg] = useState("light");
  const [pick, setPick] = useState("b");
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-[1800px] p-6" data-testid="gallery">
      <h1 className="m-0 mb-6 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold leading-[1.25]">
        Gallery
      </h1>

      <Section title="Type">
        <div className="grid gap-2">
          {SCALE.map(([token, label]) => (
            <div key={token} style={{ fontSize: `var(${token})` }}>
              {label}
            </div>
          ))}
          <code className="text-[length:var(--text-sm)]">
            Cascadia Mono for code, commands and paths
          </code>
          <div className="num text-[length:var(--text-sm)]">
            Tabular numbers: 0123456789 · 12:48 · 3.2 MB
          </div>
        </div>
      </Section>

      <Section title="Colour">
        {TOKENS.map((t) => (
          <div key={t} className="grid w-[120px] gap-1 text-[length:var(--text-xs)]">
            <div
              className="h-12 rounded-[var(--radius-md)] border border-[color:var(--line)]"
              style={{ background: `var(--${t})` }}
            />
            {t}
          </div>
        ))}
      </Section>

      <Section title="Buttons">
        {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
          <div key={v} className="grid gap-2">
            <Button variant={v}>{v}</Button>
            <Button variant={v} size="sm">
              {v} small
            </Button>
            <Button variant={v} disabled>
              {v} disabled
            </Button>
          </div>
        ))}
        <div className="grid gap-2">
          <IconButton label="Add a project">
            <Plus size={16} />
          </IconButton>
          <IconButton label="Settings" size="sm">
            <Settings size={16} />
          </IconButton>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid w-[320px] gap-3">
          <Input
            label="Name"
            placeholder="Placeholder text"
            helper="One line saying what this does."
          />
          <Input
            label="With an error"
            defaultValue="nope"
            error="Say what is wrong, under the field."
          />
          <Input label="Not saved yet" defaultValue="Edited value" unsaved helper="Save or undo." />
          <PathField
            label="Projects folder"
            defaultValue="C:\Projects"
            helper="Where your code lives."
          />
        </div>
        <div className="grid gap-3">
          <Dropdown value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Dropdown">
            <option value="a">First choice</option>
            <option value="b">Second choice</option>
            <option value="c">Third choice</option>
          </Dropdown>
          <SegmentedControl
            label="Theme"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <Tabs
            label="Tabs"
            value={tab}
            onChange={setTab}
            items={[
              { id: "one", label: "Overview" },
              { id: "two", label: "Agents" },
              { id: "three", label: "Notes" },
            ]}
          />
        </div>
      </Section>

      <Section title="Status badges">
        <div className="flex max-w-[900px] flex-wrap gap-2" data-testid="gallery-statuses">
          {Object.keys(STATUS).map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <CountPill count={3} />
          <CountPill count={12} tone="attention" />
          <CountPill count={128} tone="muted" />
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </div>
      </Section>

      <Section title="Feedback">
        <div className="grid w-[420px] gap-2">
          <Banner tone="attention" action={<Button size="sm">Fix it</Button>}>
            The projects folder is missing.
          </Banner>
          <Banner tone="danger">Claude Code is not logged in.</Banner>
          <Banner tone="info">An update is downloading.</Banner>
          <Banner tone="success">Everything is in sync.</Banner>
        </div>
        <div className="grid w-[260px] gap-2">
          <Skeleton width={26} />
          <Skeleton width={18} />
          <div className="flex items-center gap-2">
            <Spinner /> Checking tools
          </div>
        </div>
        <div className="w-[360px]">
          <Card>
            <EmptyState
              title="No projects yet"
              action={<Button variant="primary">Add projects</Button>}
            >
              Projects are the code repos Office keeps track of.
            </EmptyState>
          </Card>
        </div>
      </Section>

      <Section title="Surfaces">
        <div className="w-[420px]">
          <Card title="A card" action={<Button size="sm">Action</Button>}>
            Cards hold related content under a short title.
          </Card>
        </div>
        <div className="w-[420px]">
          {ROWS.map((r) => (
            <ListRow
              key={r.id}
              selected={r.id === pick}
              onClick={() => setPick(r.id)}
              trailing={<StatusBadge status={r.status} />}
            >
              {r.name}
            </ListRow>
          ))}
        </div>
        <div className="w-[520px]">
          <Table
            label="Projects"
            rows={ROWS}
            rowKey={(r) => r.id}
            columns={[
              { id: "name", header: "Name", cell: (r) => r.name, sortBy: (r) => r.name },
              { id: "status", header: "State", cell: (r) => <StatusBadge status={r.status} /> },
              {
                id: "n",
                header: "Files",
                cell: (r) => <span className="num">{r.count}</span>,
                sortBy: (r) => r.count,
              },
            ]}
          />
        </div>
      </Section>

      <Section title="Dialogs and notifications">
        <Button onClick={() => setOpen(true)} data-testid="gallery-open-dialog">
          Open a dialog
        </Button>
        {(["success", "info", "attention", "danger"] as const).map((tone) => (
          <Button
            key={tone}
            data-testid={`gallery-notify-${tone}`}
            onClick={() =>
              notify({
                tone,
                title: `A ${tone} notification`,
                detail: "One line of detail.",
                action: { label: "Open", run: () => undefined },
              })
            }
          >
            Notify: {tone}
          </Button>
        ))}
        {open && (
          <Dialog
            title="A dialog"
            onClose={() => setOpen(false)}
            footer={
              <>
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setOpen(false)}>
                  Confirm
                </Button>
              </>
            }
          >
            A header, a body that scrolls, and a footer. Esc closes it and Tab stays inside it.
          </Dialog>
        )}
      </Section>
    </div>
  );
}
