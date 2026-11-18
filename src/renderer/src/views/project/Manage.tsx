import { Archive, Pin, PinOff } from "lucide-react";
import { useState } from "react";
import type { ProjectSummary } from "@shared/models";
import { Button } from "../../components/ui";
import { office } from "../../lib/ipc";

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
    </div>
  );
}
