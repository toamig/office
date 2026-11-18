import { useEffect, useState } from "react";
import { paletteVariables, resolveTheme } from "@shared/theme";
import { useQuery } from "../lib/hooks";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Applies the saved theme, accent colour and density to the page as CSS variables from the shared palette.
 * "System" follows the operating system's colour scheme live. Renders nothing.
 */
export function ThemeApplier() {
  const settings = useQuery("settings.get", undefined, [
    "workspace.changed",
    "app.navigate",
    "settings.changed",
  ]);
  const s = settings.data;
  const reload = settings.reload;
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    window.addEventListener("office-settings", reload);
    return () => window.removeEventListener("office-settings", reload);
  }, [reload]);
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (): void => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!s) return;
    const theme = resolveTheme(s.theme, systemDark);
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-setting", s.theme);
    root.setAttribute("data-density", s.density);
    root.style.colorScheme = theme;
    // The accent stays the palette's own until the owner picks another.
    const custom = s.accent && s.accent !== "#3b6fd4" ? s.accent : undefined;
    for (const [name, value] of Object.entries(paletteVariables(theme, custom))) {
      root.style.setProperty(name, value);
    }
  }, [s, systemDark]);
  return null;
}
