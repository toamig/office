import {
  Bot,
  Brain as BrainIcon,
  Compass,
  FolderKanban,
  GitBranch,
  Home,
  Inbox as InboxIcon,
  KanbanSquare,
  Palette,
  Settings,
} from "lucide-react";
import { useState, type ComponentType, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery } from "../lib/hooks";
import { prefetchView } from "../lib/prefetch";
import { SIDEBAR_MAX, SIDEBAR_MIN, useSidebarCollapsed, useSidebarWidth } from "../lib/sidebar";
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
export function Sidebar({
  width,
  onResizing,
}: {
  /** The width the shell is showing now (the saved one, or the one just dragged to). */
  width: number;
  onResizing?: (width: number) => void;
}) {
  const { view, navigate } = useUi();
  const [collapsed] = useSidebarCollapsed();
  const counts = useQuery("notifications.counts", undefined, [
    "notification.new",
    "notification.read",
  ]);
  const unread = counts.data?.unread ?? 0;
  const { save } = useSidebarWidth();
  const [dragged, setDragged] = useState<number | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.buttons !== 1) return;
    const left = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const next = Math.round(Math.min(Math.max(e.clientX - left, SIDEBAR_MIN), SIDEBAR_MAX));
    setDragged(next);
    onResizing?.(next);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>): void => {
    const by = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (by === 0) return;
    e.preventDefault();
    const next = Math.min(Math.max(width + by, SIDEBAR_MIN), SIDEBAR_MAX);
    onResizing?.(next);
    save(next);
  };
  return (
    <nav data-testid="rail" data-collapsed={collapsed} className="sidebar">
      {RAIL.map((v) => (
        <button
          key={v.id}
          onClick={() => navigate(v.id)}
          onPointerEnter={() => prefetchView(v.id)}
          onFocus={() => prefetchView(v.id)}
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
      {(import.meta.env.DEV || import.meta.env.VITE_GALLERY === "1") && (
        <button
          onClick={() => navigate("gallery")}
          data-testid="rail-gallery"
          data-active={view === "gallery"}
          aria-label="Gallery"
          title={collapsed ? "Gallery" : undefined}
          className="sidebar-item mt-auto"
        >
          <Palette size={16} />
          {!collapsed && <span className="sidebar-label">Gallery</span>}
        </button>
      )}
      {!collapsed && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          aria-valuenow={dragged ?? width}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          tabIndex={0}
          data-testid="sidebar-resizer"
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={move}
          onPointerUp={() => {
            // The width stays where it was dragged; the saved setting catches up on its own.
            if (dragged !== null) save(dragged);
            setDragged(null);
          }}
          onKeyDown={keys}
        />
      )}
    </nav>
  );
}
