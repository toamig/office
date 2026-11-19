import { Columns2, PictureInPicture2, X } from "lucide-react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FunctionComponent,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "../lib/hooks";
import { REOPEN_PANEL_EVENT } from "../lib/shortcuts";
import { office } from "../lib/ipc";
import { Button, IconButton } from "./Button";
import { Dialog } from "./Dialog";
import { Input } from "./Field";
import { notifyDone, notifyError } from "./Notifications";
import { OverflowMenu, PageActionsContext, type MoreItem } from "./Page";

export interface WorkbenchPreset {
  id: string;
  label: string;
  /** Arranges the panels that are open; it may add the ones the layout needs. */
  apply: (api: DockviewApi) => void;
}

/** A panel the workbench can show, so a closed one can be brought back from the Panels list. */
export interface WorkbenchPanel {
  id: string;
  title: string;
  /** Adds the panel (it is not open). */
  add: (api: DockviewApi) => void;
}

/** What is needed to put a closed panel back where it was. */
interface ClosedPanel {
  id: string;
  component: string;
  title: string;
  params: Record<string, unknown>;
  /** A panel that shared its group, so the closed one returns beside it. */
  beside: string | null;
}

export type PanelComponent = FunctionComponent<IDockviewPanelProps<Record<string, unknown>>>;

/** A panel's tab: its title, a test id from the panel's params, and a close button unless the panel is permanent. */
function WorkTab({ api, params }: IDockviewPanelHeaderProps<Record<string, unknown>>) {
  const [title, setTitle] = useState(api.title ?? api.id);
  useEffect(() => {
    const d = api.onDidTitleChange((e) => setTitle(e.title));
    return () => d.dispose();
  }, [api]);
  const testId = typeof params["testId"] === "string" ? params["testId"] : "dock-tab";
  return (
    <div className="dock-tab" data-testid={testId} data-panel={api.id}>
      <span className="dock-tab-title">{title}</span>
      {params["permanent"] !== true && (
        <IconButton
          label="Close tab"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            api.close();
          }}
        >
          <X />
        </IconButton>
      )}
    </div>
  );
}

/** What a group offers beside its tabs: split the active panel to the right, or float it. */
function GroupActions({ containerApi, activePanel, group }: IDockviewHeaderActionsProps) {
  if (!activePanel) return null;
  return (
    <div className="dock-actions">
      <IconButton
        label="Split to the right"
        size="sm"
        data-testid="dock-split-right"
        onClick={() => {
          const next = containerApi.addGroup({ referenceGroup: group, direction: "right" });
          activePanel.api.moveTo({ group: next });
        }}
      >
        <Columns2 />
      </IconButton>
      <IconButton
        label="Float this panel"
        size="sm"
        data-testid="dock-float"
        onClick={() =>
          containerApi.addFloatingGroup(activePanel, {
            position: { top: 96, left: 120 },
            width: 560,
            height: 380,
          })
        }
      >
        <PictureInPicture2 />
      </IconButton>
    </div>
  );
}

/**
 * A workbench: panels you can tab, split, drag to dock and float. Its layout is remembered per workbench and scope on
 * this PC; you can save one under a name, switch between saved ones and the presets, and reset it. A panel that stays
 * mounted ("always") is never restarted by a move, so a terminal keeps its scrollback and a chat its stream.
 */
export function Workbench({
  workbench,
  scope,
  components,
  initial,
  presets,
  onReady,
  onActive,
  toolbar,
  empty,
  catalog = [],
  layoutItems = [],
  groupActions = true,
}: {
  /** The kind of workbench: "agents", "project" or "git". */
  workbench: string;
  /** What the layout belongs to: a project id, or "all". */
  scope: string;
  components: Record<string, PanelComponent>;
  /** The layout a fresh workbench starts with, and the one Reset goes back to. */
  initial: (api: DockviewApi) => void;
  presets: WorkbenchPreset[];
  onReady?: (api: DockviewApi) => void;
  /** The id of the panel that became active (or null when none is). */
  onActive?: (panelId: string | null) => void;
  toolbar?: React.ReactNode;
  /** Shown over the dock while no panel is open. */
  empty?: React.ReactNode;
  /** Every panel this view can show: the Layout menu lists them with a check for the open ones. */
  catalog?: WorkbenchPanel[];
  /** More items for the Layout menu, after the arrangements. */
  layoutItems?: MoreItem[];
  /** Whether each group offers Split and Float beside its tabs. */
  groupActions?: boolean;
}) {
  const key = `${workbench}:${scope}`;
  const saved = useQuery("dock.list", { prefix: `set:${workbench}:` }, []);
  const apiRef = useRef<DockviewApi | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [count, setCount] = useState(1);
  /** Changes whenever the panels do, so the Panels list shows what is open now. */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const closed = useRef<ClosedPanel[]>([]);

  const save = useCallback((): void => {
    const api = apiRef.current;
    if (!api || !loaded.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void office.invoke("dock.set", { key, json: JSON.stringify(api.toJSON()) });
    }, 300);
  }, [key]);

  const ready = (e: DockviewReadyEvent): void => {
    const api = e.api;
    apiRef.current = api;
    api.onDidLayoutChange(() => {
      setCount(api.panels.length);
      setOpenIds(new Set(api.panels.map((p) => p.id)));
      save();
    });
    // Remember each closed panel, so it can be brought back where it was.
    api.onDidRemovePanel((panel) => {
      if (!loaded.current) return;
      const sibling = panel.group.panels.find((p) => p.id !== panel.id);
      closed.current = [
        ...closed.current.filter((c) => c.id !== panel.id),
        {
          id: panel.id,
          component: panel.api.component,
          title: panel.api.title ?? panel.id,
          params: (panel.params ?? {}) as Record<string, unknown>,
          beside: sibling?.id ?? null,
        },
      ].slice(-20);
    });
    api.onDidActivePanelChange((e) => onActive?.(e.panel?.id ?? null));
    void office.invoke("dock.get", { key }).then(
      (json) => {
        try {
          if (json) api.fromJSON(JSON.parse(json));
          else initial(api);
        } catch {
          api.clear();
          initial(api);
        }
        loaded.current = true;
        setCount(api.panels.length);
        onReady?.(api);
      },
      () => {
        initial(api);
        loaded.current = true;
        onReady?.(api);
      },
    );
  };
  // A pending save is not lost when the workbench goes away.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const api = apiRef.current;
      if (api && loaded.current)
        void office.invoke("dock.set", { key, json: JSON.stringify(api.toJSON()) });
    },
    [key],
  );

  const reset = (): void => {
    const api = apiRef.current;
    if (!api) return;
    api.clear();
    initial(api);
    save();
  };
  const loadSaved = async (full: string): Promise<void> => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const json = await office.invoke("dock.get", { key: full });
      if (json) {
        api.fromJSON(JSON.parse(json));
        save();
      }
    } catch (err) {
      notifyError(err, "That layout could not be opened", `dock-${workbench}`);
    }
  };
  const saveAs = async (): Promise<void> => {
    const api = apiRef.current;
    const clean = name.trim();
    if (!api || !clean) return;
    try {
      await office.invoke("dock.set", {
        key: `set:${workbench}:${clean}`,
        json: JSON.stringify(api.toJSON()),
      });
      notifyDone("Layout saved", clean, `dock-${workbench}`);
      setNaming(false);
      setName("");
      saved.reload();
    } catch (err) {
      notifyError(err, "That layout was not saved", `dock-${workbench}`);
    }
  };

  /** Brings a closed panel back, beside the one it shared a group with when that is still open. */
  const reopen = (panel: ClosedPanel): void => {
    const api = apiRef.current;
    if (!api) return;
    closed.current = closed.current.filter((c) => c.id !== panel.id);
    const reference = panel.beside ? api.getPanel(panel.beside) : undefined;
    api.addPanel({
      id: panel.id,
      component: panel.component,
      title: panel.title,
      params: panel.params,
      renderer: "always",
      ...(reference ? { position: { referencePanel: reference.id } } : {}),
    });
    save();
  };
  const reopenLast = (): void => {
    const last = closed.current.at(-1);
    if (last) reopen(last);
  };
  // Ctrl+Shift+T (the app's shortcut) brings back the panel closed last, in the workbench that is on screen.
  useEffect(() => {
    const onReopen = (): void => {
      if (root.current && root.current.offsetParent !== null) reopenLast();
    };
    window.addEventListener(REOPEN_PANEL_EVENT, onReopen);
    return () => window.removeEventListener(REOPEN_PANEL_EVENT, onReopen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slot = useContext(PageActionsContext);
  const savedNames = saved.data ?? [];
  const layoutMenu = (
    <OverflowMenu
      trigger="Layout"
      testId="workbench-layout"
      items={[
        ...presets.map((p) => ({
          label: `Arrange: ${p.label}`,
          testId: `workbench-preset-${p.id}`,
          onSelect: () => {
            const api = apiRef.current;
            if (api) {
              p.apply(api);
              save();
            }
          },
        })),
        ...savedNames.map((k) => ({
          label: `Open layout: ${k.slice(`set:${workbench}:`.length)}`,
          testId: `workbench-saved-${k.slice(`set:${workbench}:`.length)}`,
          onSelect: () => void loadSaved(k),
        })),
        {
          label: "Save layout as...",
          testId: "workbench-save-as",
          onSelect: () => setNaming(true),
        },
        ...layoutItems,
        ...(catalog.length > 0
          ? catalog.map((c) => {
              const open = openIds.has(c.id);
              return {
                label: c.title,
                checked: open,
                testId: `workbench-panel-${c.id}`,
                onSelect: () => {
                  const api = apiRef.current;
                  if (!api) return;
                  const existing = api.getPanel(c.id);
                  if (existing) existing.api.setActive();
                  else {
                    const was = closed.current.find((x) => x.id === c.id);
                    if (was) reopen(was);
                    else {
                      c.add(api);
                      save();
                    }
                  }
                },
              };
            })
          : []),
        {
          label: "Reopen the last closed panel",
          hint: "Ctrl+Shift+T",
          testId: "workbench-reopen",
          onSelect: reopenLast,
        },
        { label: "Reset layout", testId: "workbench-reset", onSelect: reset },
      ]}
    />
  );
  return (
    <div className="workbench" data-testid="workbench" data-workbench={workbench} ref={root}>
      {slot ? createPortal(layoutMenu, slot) : <div className="workbench-bar">{layoutMenu}</div>}
      {toolbar && <div className="workbench-bar">{toolbar}</div>}
      <div className="workbench-dock">
        {count === 0 && empty && (
          <div className="workbench-empty" data-testid="workbench-empty">
            {empty}
          </div>
        )}
        <DockviewReact
          className="dockview-theme-office"
          components={components as Record<string, FunctionComponent<IDockviewPanelProps>>}
          defaultTabComponent={WorkTab as FunctionComponent<IDockviewPanelHeaderProps>}
          {...(groupActions ? { rightHeaderActionsComponent: GroupActions } : {})}
          onReady={ready}
        />
      </div>
      {naming && (
        <Dialog
          title="Save this layout"
          testId="layout-name-dialog"
          onClose={() => setNaming(false)}
          footer={
            <>
              <Button onClick={() => setNaming(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name.trim()}
                onClick={() => void saveAs()}
                data-testid="layout-name-save"
              >
                Save
              </Button>
            </>
          }
        >
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            helper="You can open it again from the Layout menu."
            data-testid="layout-name"
          />
        </Dialog>
      )}
    </div>
  );
}

/** Moves every panel into one group, as tabs: the layout of "one thing at a time". */
export function tabsTogether(api: DockviewApi): void {
  const first = api.activePanel ?? api.panels[0];
  if (!first) return;
  for (const p of api.panels) if (p.group !== first.group) p.api.moveTo({ group: first.group });
}

/** Puts a panel in a new group beside or under another panel; the panel is moved, never remounted. */
export function splitBeside(
  api: DockviewApi,
  panelId: string,
  reference: string,
  direction: "right" | "below" = "right",
): void {
  const panel = api.getPanel(panelId);
  const ref = api.getPanel(reference);
  if (!panel || !ref || panel.group === ref.group) {
    if (panel && ref && panel.group === ref.group && api.panels.length > 1) {
      const group = api.addGroup({ referenceGroup: ref.group, direction });
      panel.api.moveTo({ group });
    }
    return;
  }
  const group = api.addGroup({ referenceGroup: ref.group, direction });
  panel.api.moveTo({ group });
}
