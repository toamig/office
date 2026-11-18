import {
  Bot,
  Brain,
  Compass,
  GitBranch,
  Home,
  Inbox,
  KanbanSquare,
  FolderKanban,
  Settings,
} from "lucide-react";

const views = [
  { id: "home", label: "Home", icon: Home },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "setup", label: "Setup", icon: Settings },
];

export default function App() {
  return (
    <div className="flex h-full">
      <nav
        data-testid="rail"
        className="flex w-44 flex-col gap-0.5 border-r p-2"
        style={{ background: "var(--rail)", borderColor: "var(--line)" }}
      >
        {views.map((v) => (
          <div key={v.id} className="flex items-center gap-2 rounded px-2 py-1.5">
            <v.icon size={16} />
            {v.label}
          </div>
        ))}
      </nav>
      <main className="flex-1 p-4">Office</main>
    </div>
  );
}
