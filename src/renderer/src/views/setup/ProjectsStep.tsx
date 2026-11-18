import { useState } from "react";
import { Button, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { PathField } from "./PathField";

/** Choosing the projects folder: each project in the workspace config is a folder under it. */
export function ProjectsStep({ onDone }: { onDone?: () => void }) {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed", "setup.changed"]);
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = typed ?? workspace.data?.projectsRoot ?? "";

  const save = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await office.invoke("setup.setProjectsRoot", { path: value });
      setTyped(null);
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="projects-step">
      {error && (
        <div className="mb-3" data-testid="wizard-error">
          <ErrorBanner message={error} />
        </div>
      )}
      <p className="mb-3 mt-0">
        Where do your project folders live? Each project in the workspace config is a folder under
        this one.
      </p>
      <PathField
        label="Projects folder"
        value={value}
        onChange={setTyped}
        testId="setup-projects"
        pickTitle="Projects folder"
      />
      <Button
        variant="primary"
        disabled={busy || !value}
        onClick={() => void save()}
        data-testid="setup-projects-save"
      >
        {busy ? "Saving..." : "Use this folder"}
      </Button>
    </div>
  );
}
