import { office } from "./ipc";
import { useQuery } from "./hooks";

/** Whether the sidebar shows icons only, and a way to flip it. The choice is a machine setting. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const settings = useQuery("settings.get", undefined, ["settings.changed"]);
  const collapsed = settings.data?.sidebarCollapsed ?? false;
  const toggle = (): void => {
    void office
      .invoke("settings.set", { sidebarCollapsed: !collapsed })
      .then(() => window.dispatchEvent(new Event("office-settings")));
  };
  return [collapsed, toggle];
}

/** The sidebar's open width in pixels (200 to 320), the width while it is collapsed (56), and a way to set the open one. */
export const SIDEBAR_COLLAPSED = 56;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;

export function useSidebarWidth(): { width: number; save: (value: number) => void } {
  const settings = useQuery("settings.get", undefined, ["settings.changed"]);
  return {
    width: settings.data?.sidebarWidth ?? 240,
    save: (value) => {
      void office.invoke("settings.set", {
        sidebarWidth: Math.round(Math.min(Math.max(value, SIDEBAR_MIN), SIDEBAR_MAX)),
      });
    },
  };
}
