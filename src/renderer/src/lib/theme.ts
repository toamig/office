import { useEffect, useState } from "react";
import type { ThemeName } from "@shared/theme";

const read = (): { theme: ThemeName; accent: string | undefined } => ({
  theme: document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  accent: document.documentElement.style.getPropertyValue("--accent").trim() || undefined,
});

/** The theme and accent the page shows now, updated whenever ThemeApplier changes them. */
export function useTheme(): { theme: ThemeName; accent: string | undefined } {
  const [state, setState] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = read();
      setState((old) => (old.theme === next.theme && old.accent === next.accent ? old : next));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return state;
}
