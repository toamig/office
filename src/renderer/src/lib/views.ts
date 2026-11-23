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
  workflows: "Workflows",
  gallery: "Gallery",
};

/** The views in the order of the sidebar. Setup is not in it: it sits apart at the bottom. */
export const SIDEBAR_ORDER: ViewId[] = [
  "home", "projects", "agents", "explore", "board", "git", "brain", "workflows", "tools", "inbox",
];
