import { Archive, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import type { ProjectSummary } from "@shared/models";
import { Button } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { PointerDialog } from "../onboarding/PointerDialog";

const field = "rounded border px-2 py-1";
const fieldStyle = { borderColor: "var(--line)", background: "var(--bg)", color: "var(--text)" };

/** Pin, group and archive one project. The change is written to the workspace config. */
export function ProjectManage({
  project,
  onError,
}: {
  project: ProjectSummary;
  onError: (message: string) => void;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const [pointer, setPointer] = useState<"add" | "remove" | null>(null);
  const [removing, setRemoving] = useState(false);
  const navigate = useUi((s) => s.navigate);
  const update = async (patch: {
    pinned?: boolean;
    group?: string | null;
    archived?: boolean;
  }): Promise<void> => {
    try {
      await office.invoke("projects.update", { id: project.id, ...patch });
    } catch (err) {
      onError((err as Error).message);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="project-manage">
      <Button onClick={() => void update({ pinned: !project.pinned })} data-testid="project-pin">
        {project.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        {project.pinned ? " Unpin" : " Pin"}
      </Button>
      <input
        className={field}
        style={fieldStyle}
        placeholder="Group"
        value={group ?? project.group ?? ""}
        onChange={(e) => setGroup(e.target.value)}
        aria-label="Group"
        data-testid="project-group"
      />
      <Button
        disabled={group === null}
        onClick={() => void update({ group: group ?? "" }).then(() => setGroup(null))}
        data-testid="project-group-save"
      >
        Set group
      </Button>
      <Button onClick={() => void update({ archived: true })} data-testid="project-archive">
        <Archive size={13} /> Archive
      </Button>
      <Button onClick={() => setPointer("add")} data-testid="project-pointer-add">
        Agent pointer
      </Button>
      <Button onClick={() => setPointer("remove")} data-testid="project-pointer-remove">
        Remove the pointer
      </Button>
      <Button onClick={() => setRemoving(true)} data-testid="project-remove">
        Remove from Office
      </Button>
      {pointer && (
        <PointerDialog ids={[project.id]} mode={pointer} onClose={() => setPointer(null)} />
      )}
      {removing && (
        <div className="dialog-backdrop" data-testid="remove-confirm">
          <div className="dialog w-[480px] max-w-[92vw]">
            <header className="dialog-header">
              <span className="font-semibold">Remove {project.name} from Office?</span>
            </header>
            <p className="m-0 p-4">
              Only the entry in the workspace config goes. Its notes, its code and the agent pointer
              stay where they are, and you can add the project again later.
            </p>
            <footer
              className="flex justify-end gap-2 border-t px-4 py-2.5"
              style={{ borderColor: "var(--line)" }}
            >
              <Button onClick={() => setRemoving(false)}>Cancel</Button>
              <Button
                variant="primary"
                data-testid="remove-yes"
                onClick={() =>
                  void office.invoke("onboarding.remove", { id: project.id }).then(
                    () => navigate("projects"),
                    (err: Error) => onError(err.message),
                  )
                }
              >
                Remove from Office
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
