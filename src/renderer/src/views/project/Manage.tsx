import { useState } from "react";
import type { ProjectSummary } from "@shared/models";
import { office } from "../../lib/ipc";
import { fixAction } from "../../lib/fix";
import { useUi } from "../../stores/ui";
import { Button, Dialog, Input, notifyError, type MoreItem } from "../../ui";
import { PointerDialog } from "../onboarding/PointerDialog";

/** The secondary actions of a project page, as menu items, and the dialogs they open. */
export function useProjectManage(project: ProjectSummary): {
  items: MoreItem[];
  dialogs: React.ReactNode;
} {
  const [pointer, setPointer] = useState<"add" | "remove" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [group, setGroup] = useState("");
  const navigate = useUi((s) => s.navigate);
  const update = async (patch: {
    pinned?: boolean;
    group?: string | null;
    archived?: boolean;
  }): Promise<void> => {
    try {
      await office.invoke("projects.update", { id: project.id, ...patch });
    } catch (err) {
      notifyError(
        err,
        `Could not change ${project.name}`,
        `project-${project.id}`,
        fixAction(`Could not change ${project.name}`, err, { projectId: project.id }),
      );
    }
  };
  const items: MoreItem[] = [
    {
      label: project.pinned ? "Unpin" : "Pin",
      onSelect: () => void update({ pinned: !project.pinned }),
      testId: "project-pin",
    },
    {
      label: "Set group...",
      onSelect: () => {
        setGroup(project.group ?? "");
        setGrouping(true);
      },
      testId: "project-group-open",
    },
    {
      label: "Archive",
      onSelect: () => void update({ archived: true }),
      testId: "project-archive",
    },
    {
      label: "Add the agent pointer...",
      onSelect: () => setPointer("add"),
      testId: "project-pointer-add",
    },
    {
      label: "Remove the agent pointer...",
      onSelect: () => setPointer("remove"),
      testId: "project-pointer-remove",
    },
    {
      label: "Remove from Office...",
      onSelect: () => setRemoving(true),
      danger: true,
      testId: "project-remove",
    },
  ];
  const dialogs = (
    <>
      {pointer && (
        <PointerDialog ids={[project.id]} mode={pointer} onClose={() => setPointer(null)} />
      )}
      {grouping && (
        <Dialog
          title={`Group for ${project.name}`}
          onClose={() => setGrouping(false)}
          testId="group-dialog"
          footer={
            <>
              <Button onClick={() => setGrouping(false)}>Cancel</Button>
              <Button
                variant="primary"
                data-testid="project-group-save"
                onClick={() => void update({ group }).then(() => setGrouping(false))}
              >
                Set group
              </Button>
            </>
          }
        >
          <Input
            label="Group"
            helper="Projects with the same group sit together on the Projects page. Leave it empty for none."
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            data-testid="project-group"
          />
        </Dialog>
      )}
      {removing && (
        <Dialog
          title={`Remove ${project.name} from Office?`}
          onClose={() => setRemoving(false)}
          testId="remove-confirm"
          footer={
            <>
              <Button onClick={() => setRemoving(false)}>Cancel</Button>
              <Button
                variant="danger"
                data-testid="remove-yes"
                onClick={() =>
                  void office.invoke("onboarding.remove", { id: project.id }).then(
                    () => navigate("projects"),
                    (err: unknown) => notifyError(err, `Could not remove ${project.name}`),
                  )
                }
              >
                Remove from Office
              </Button>
            </>
          }
        >
          Only the entry in the workspace config goes. Its notes, its code and the agent pointer
          stay where they are, and you can add the project again later.
        </Dialog>
      )}
    </>
  );
  return { items, dialogs };
}
