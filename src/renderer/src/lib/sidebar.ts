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
