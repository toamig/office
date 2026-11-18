import { useState } from "react";
import { useUi } from "../stores/ui";
import { BoardTab } from "./board/BoardTab";
import { RolesTab } from "./board/RolesTab";

type Tab = "board" | "roles";

/** The orchestrator: the task board, and the roles that decide who plans, builds and reviews. */
export function Board() {
  const [tab, setTab] = useState<Tab>("board");
  // A notification or a Home row can link straight to one task.
  const task = useUi((s) => s.params["task"]);
  return (
    <div className="p-4" data-testid="board">
      <div className="mb-3 flex items-center gap-4">
        <h1 className="m-0 text-lg font-semibold">Board</h1>
        <div className="flex gap-1">
          {(
            [
              ["board", "Tasks"],
              ["roles", "Roles"],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              data-testid={`board-tab-${id}`}
              className="cursor-pointer border-0 bg-transparent px-3 py-1.5"
              style={{
                color: "var(--text)",
                borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
                fontWeight: tab === id ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "board" && <BoardTab {...(task ? { initialTask: task } : {})} />}
      {tab === "roles" && <RolesTab />}
    </div>
  );
}
