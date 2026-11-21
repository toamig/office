import type { ViewId } from "../stores/ui";

/** The name of each view, for the sidebar and the top bar. */
export const VIEW_LABELS: Record<ViewId, string> = {
  home: "Home",
  projects: "Projects",
  project: "Project",
  agents: "Sessions",
  git: "Git",
  board: "Board",
  brain: "Brain",
  inbox: "Needs you",
  explore: "Chat",
  setup: "Setup",
  tools: "Tools",
  gallery: "Gallery",
};
