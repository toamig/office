import { useQuery } from "./hooks";
import { office } from "./ipc";
import type { ViewId } from "../stores/ui";

/** The views that have an inspector: a panel on the right with the details of what is selected. */
export const INSPECTOR_VIEWS: ViewId[] = ["agents", "project", "board", "git", "inbox"];
export const INSPECTOR_MIN = 280;
export const INSPECTOR_MAX = 480;

export interface InspectorState {
  /** Whether this view has an inspector at all. */
  available: boolean;
  /** Whether it is showing. */
  open: boolean;
  width: number;
  toggle: () => void;
  save: (width: number) => void;
}

/** The inspector of a view: shown or hidden per view, and one width for all, both remembered on this PC. */
export function useInspector(view: ViewId): InspectorState {
  const settings = useQuery("settings.get", undefined, ["settings.changed"]);
  const available = INSPECTOR_VIEWS.includes(view);
  const hidden = settings.data?.inspectorHidden[view] === true;
  return {
    available,
    open: available && !hidden,
    width: settings.data?.inspectorWidth ?? 320,
    toggle: () => {
      void office.invoke("settings.set", { inspectorHidden: { [view]: !hidden } });
    },
    save: (width) => {
      void office.invoke("settings.set", {
        inspectorWidth: Math.round(Math.min(Math.max(width, INSPECTOR_MIN), INSPECTOR_MAX)),
      });
    },
  };
}
