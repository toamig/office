import { useState } from "react";
import type { WorkspaceInspection } from "@shared/models";
import { Button, Chip, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { fieldClass, fieldStyle, PathField } from "./PathField";

/**
 * Choosing the workspace: a folder that is already here, or a git repo to clone. Office keeps the project
 * list, roles and pipelines in this repo so they travel to any PC. Used by the welcome flow and by Setup.
 */
export function WorkspaceStep({ onDone }: { onDone?: () => void }) {
  const [mode, setMode] = useState<"folder" | "clone">("folder");
  const [root, setRoot] = useState("");
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [inspection, setInspection] = useState<WorkspaceInspection | null>(null);
  const [configPath, setConfigPath] = useState("Office/workspace.json");
  const [create, setCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = async (work: () => Promise<void>): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = (path: string): Promise<void> =>
    guard(async () => {
      const found = await office.invoke("setup.inspect", { root: path });
      if (!found.exists) throw new Error(`${path} is not a folder`);
      setInspection(found);
      setRoot(path);
      if (found.configs[0]) setConfigPath(found.configs[0]);
      else setCreate(true);
    });

  const clone = (): Promise<void> =>
    guard(async () => {
      const result = await office.invoke("setup.clone", { url, dest });
      await chooseFolder(result.path);
    });

  const use = (): Promise<void> =>
    guard(async () => {
      await office.invoke("setup.apply", {
        workspaceRoot: root,
        workspaceConfigPath: configPath,
        projectsRoot: "",
        createIfMissing: create,
      });
      setInspection(null);
      onDone?.();
    });

  return (
    <div data-testid="wizard">
      {error && (
        <div className="mb-3" data-testid="wizard-error">
          <ErrorBanner message={error} />
        </div>
      )}
      {!inspection && (
        <>
          <p className="mb-3 mt-0">
            Office keeps your project list, roles and pipelines in a git repo you choose, so they
            travel to any PC. Use a folder that is already here, or clone the repo.
          </p>
          <div className="mb-3 flex gap-4">
            <label>
              <input type="radio" checked={mode === "folder"} onChange={() => setMode("folder")} />{" "}
              Use a folder
            </label>
            <label>
              <input
                type="radio"
                checked={mode === "clone"}
                onChange={() => setMode("clone")}
                data-testid="mode-clone"
              />{" "}
              Clone from a git URL
            </label>
          </div>
          {mode === "folder" && (
            <>
              <PathField
                label="Workspace folder"
                value={root}
                onChange={setRoot}
                testId="setup-root"
                pickTitle="Workspace repo folder"
              />
              <Button
                variant="primary"
                disabled={busy || !root}
                onClick={() => void chooseFolder(root)}
                data-testid="setup-use-folder"
              >
                Use this folder
              </Button>
            </>
          )}
          {mode === "clone" && (
            <>
              <label className="mb-2 flex items-center gap-2">
                <span className="w-40">Git URL</span>
                <input
                  className={fieldClass}
                  style={fieldStyle}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  data-testid="setup-url"
                  aria-label="Git URL"
                />
              </label>
              <PathField
                label="Clone into"
                value={dest}
                onChange={setDest}
                testId="setup-dest"
                pickTitle="Empty folder to clone into"
              />
              <Button
                variant="primary"
                disabled={busy || !url || !dest}
                onClick={() => void clone()}
                data-testid="setup-clone"
              >
                {busy ? "Cloning..." : "Clone"}
              </Button>
            </>
          )}
        </>
      )}
      {inspection && (
        <>
          <p className="mb-3 mt-0">
            {inspection.hasBrainHub ? (
              <Chip tone="good">brain hub</Chip>
            ) : (
              <Chip>plain folder</Chip>
            )}{" "}
            Found {inspection.configs.length} config file(s) in {root}.
          </p>
          <label className="mb-2 flex items-center gap-2">
            <span className="w-40">Config file</span>
            <input
              className={fieldClass}
              style={fieldStyle}
              value={configPath}
              onChange={(e) => setConfigPath(e.target.value)}
              data-testid="setup-config"
              aria-label="Config file"
            />
          </label>
          <label className="mb-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={create}
              onChange={(e) => setCreate(e.target.checked)}
              data-testid="setup-create"
            />{" "}
            Create it from the example if it does not exist
          </label>
          <div className="flex gap-2">
            <Button onClick={() => setInspection(null)}>Back</Button>
            <Button
              variant="primary"
              disabled={busy || !configPath}
              onClick={() => void use()}
              data-testid="setup-use-workspace"
            >
              {busy ? "Saving..." : "Use this workspace"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
