import {
  Bot,
  Brain as BrainIcon,
  Compass,
  FolderKanban,
  GitBranch,
  Home,
  Inbox as InboxIcon,
  KanbanSquare,
  Settings,
} from "lucide-react";
import type { ComponentType } from "react";
import { useQuery } from "../lib/hooks";
import { useSidebarCollapsed } from "../lib/sidebar";
import { VIEW_LABELS } from "../lib/views";
import { useUi, type ViewId } from "../stores/ui";

/** The views in the order of the sidebar; Ctrl+1 to Ctrl+9 follow this order. */
export const RAIL: Array<{ id: ViewId; icon: ComponentType<{ size?: number }> }> = [
  { id: "home", icon: Home },
  { id: "projects", icon: FolderKanban },
  { id: "agents", icon: Bot },
  { id: "git", icon: GitBranch },
  { id: "board", icon: KanbanSquare },
  { id: "brain", icon: BrainIcon },
  { id: "inbox", icon: InboxIcon },
  { id: "explore", icon: Compass },
  { id: "setup", icon: Settings },
];

/** The sidebar: icons and labels, or icons only when collapsed. */
export function Sidebar() {
  const { view, navigate } = useUi();
  const [collapsed] = useSidebarCollapsed();
  const counts = useQuery("notifications.counts", undefined, [
    "notification.new",
    "notification.read",
  ]);
  const unread = counts.data?.unread ?? 0;
  return (
    <nav
      data-testid="rail"
      data-collapsed={collapsed}
      className="sidebar"
      style={{ width: collapsed ? 52 : 196 }}
    >
      {RAIL.map((v) => (
        <button
          key={v.id}
          onClick={() => navigate(v.id)}
          data-testid={`rail-${v.id}`}
          data-active={view === v.id}
          title={collapsed ? VIEW_LABELS[v.id] : undefined}
          aria-label={VIEW_LABELS[v.id]}
          className="sidebar-item"
        >
          <v.icon size={16} />
          {!collapsed && <span className="sidebar-label">{VIEW_LABELS[v.id]}</span>}
          {v.id === "inbox" && unread > 0 && (
            <span data-testid="inbox-count" className="count-badge">
              {unread}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
