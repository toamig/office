import { Plus } from "lucide-react";
import { useState } from "react";
import { useUi } from "../stores/ui";
import { Button, Page, Tabs } from "../ui";
import { BoardTab } from "./board/BoardTab";
import { PermissionsTab } from "./board/PermissionsTab";
import { PipelinesTab } from "./board/PipelinesTab";
import { RolesTab } from "./board/RolesTab";

type Tab = "board" | "pipelines" | "roles" | "permissions";

/** The orchestrator: the task board, the pipelines tasks run through, the roles that do each stage, and what they may do. */
export function Board() {
  const [tab, setTab] = useState<Tab>("board");
  const [creating, setCreating] = useState(false);
  // A notification or a Home row can link straight to one task.
  const task = useUi((s) => s.params["task"]);
  return (
    <Page
      title="Board"
      testId="board"
      fill
      primary={
        tab === "board" ? (
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-task-open">
            <Plus /> New task
          </Button>
        ) : undefined
      }
    >
      <Tabs
        label="Board sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: "board", label: "Tasks", testId: "board-tab-board" },
          { id: "pipelines", label: "Pipelines", testId: "board-tab-pipelines" },
          { id: "roles", label: "Roles", testId: "board-tab-roles" },
          { id: "permissions", label: "Permissions", testId: "board-tab-permissions" },
        ]}
      />
      {tab === "board" && (
        <BoardTab
          {...(task ? { initialTask: task } : {})}
          creating={creating}
          onCloseCreate={() => setCreating(false)}
        />
      )}
      {tab === "pipelines" && <PipelinesTab />}
      {tab === "roles" && <RolesTab goTo={setTab} />}
      {tab === "permissions" && <PermissionsTab />}
    </Page>
  );
}
