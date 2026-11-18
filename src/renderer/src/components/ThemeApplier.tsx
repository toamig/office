import { useEffect } from "react";
import { useQuery } from "../lib/hooks";

/** Applies the saved theme, accent colour and density to the page. Renders nothing. */
export function ThemeApplier() {
  const settings = useQuery("settings.get", undefined, ["workspace.changed", "app.navigate"]);
  const s = settings.data;
  const reload = settings.reload;
  useEffect(() => {
    window.addEventListener("office-settings", reload);
    return () => window.removeEventListener("office-settings", reload);
  }, [reload]);
  useEffect(() => {
    if (!s) return;
    const root = document.documentElement;
    if (s.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", s.theme);
    root.setAttribute("data-density", s.density);
    root.style.setProperty("--accent", s.accent);
  }, [s]);
  return null;
}
