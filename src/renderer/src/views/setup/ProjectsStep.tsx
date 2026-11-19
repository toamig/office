import { useEffect, useRef, useState } from "react";
import type { FolderScan, RootSuggestion } from "@shared/models";
import { useUnsaved } from "../../components/LeaveGuard";
import { Button, StatusBadge, notifyError } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";
import { PathField } from "./PathField";

const same = (a: string, b: string): boolean =>
  a.replaceAll("\\", "/").toLowerCase().replace(/\/$/, "") ===
  b.replaceAll("\\", "/").toLowerCase().replace(/\/$/, "");

/** "Found 14 of 16 projects", and the ones that are not there, named. */
function Found({ scan }: { scan: FolderScan }) {
  return (
    <div data-testid="projects-found">
      <StatusBadge
        status="info"
        tone={
          scan.found.length === scan.total
            ? "success"
            : scan.found.length === 0
              ? "danger"
              : "attention"
        }
        label={`Found ${scan.found.length} of ${scan.total} projects`}
      />
      {scan.missing.length > 0 && (
        <div className="mt-1 text-[length:var(--text-sm)] ui-muted" data-testid="projects-missing">
          Not found here: {scan.missing.join(", ")}.
        </div>
      )}
    </div>
  );
}

/**
 * Choosing the projects folder. It says where the list of projects comes from, suggests the folder where most of them
 * are, and after a choice says how many were found and which were not. A typed value that is not saved yet says so,
 * with Save and Undo, and a folder holding none of the projects is asked about first.
 */
export function ProjectsStep({ onDone }: { onDone?: () => void }) {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed", "setup.changed"]);
  const saved = workspace.data?.projectsRoot ?? "";
  const [typed, setTyped] = useState<string | null>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [suggestion, setSuggestion] = useState<RootSuggestion | null>(null);
  const [ask, setAsk] = useState<{ path: string; scan: FolderScan } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const busy = useRef(false);

  const value = typed ?? saved;
  const dirty = typed !== null && !same(typed.trim(), saved);
  useUnsaved("projects-root", dirty ? "The projects folder you typed is not saved yet." : null);

  // What is in the saved folder, and where the projects probably are.
  useEffect(() => {
    let alive = true;
    void office.invoke("setup.suggestProjectsRoot").then((s) => alive && setSuggestion(s));
    if (saved)
      void office
        .invoke("setup.scanProjectsRoot", { path: saved })
        .then((r) => alive && setScan(r));
    return () => {
      alive = false;
    };
  }, [saved]);

  const save = async (path: string): Promise<void> => {
    busy.current = true;
    try {
      await office.invoke("setup.setProjectsRoot", { path });
      setTyped(null);
      setAsk(null);
      setScan(await office.invoke("setup.scanProjectsRoot", { path }));
      setJustSaved(true);
      onDone?.();
    } catch (err) {
      notifyError(err, "Could not use that folder", "projects-root");
    } finally {
      busy.current = false;
    }
  };

  /** The value is final (Enter, leaving the field, Browse): save it, after asking when it holds none of the projects. */
  const commit = async (raw: string): Promise<void> => {
    const path = raw.trim();
    if (!path || same(path, saved) || busy.current) return;
    setJustSaved(false);
    try {
      const found = await office.invoke("setup.scanProjectsRoot", { path });
      if (found.total > 0 && found.found.length === 0) setAsk({ path, scan: found });
      else await save(path);
    } catch (err) {
      notifyError(err, "Could not use that folder", "projects-root");
    }
  };

  const total = scan?.total ?? suggestion?.total ?? 0;
  const better =
    suggestion?.best && !same(suggestion.best, saved) ? suggestion.candidates[0] : undefined;

  return (
    <div data-testid="projects-step">
      <p className="mb-3 mt-0">
        Where do your project folders live? Each project in your workspace is a folder under this
        one.
        {total > 0 && (
          <span className="ui-muted" data-testid="projects-total">
            {" "}
            Your workspace lists {total} projects (from its config in the brain).
          </span>
        )}
      </p>
      {better && (
        <div
          className="ui-surface mb-3 flex items-center gap-3 p-3"
          data-testid="projects-suggestion"
        >
          <span className="flex-1">
            Found {better.found} of {better.total} projects in <b>{better.path}</b>.
          </span>
          <Button
            variant="primary"
            onClick={() => void save(better.path)}
            data-field-action
            data-testid="projects-use-suggestion"
          >
            Use this folder
          </Button>
        </div>
      )}
      <PathField
        label="Projects folder"
        value={value}
        onChange={setTyped}
        onCommit={(v) => void commit(v)}
        testId="setup-projects"
        pickTitle="Projects folder"
      />
      {ask && (
        <div className="ui-ask" data-testid="projects-none-found">
          <div className="mb-2">
            None of your {ask.scan.total} projects are in <b>{ask.path}</b>. Use it anyway?
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => void save(ask.path)}
              data-field-action
              data-testid="projects-use-anyway"
            >
              Use it anyway
            </Button>
            <Button
              data-field-action
              onClick={() => {
                setAsk(null);
                setTyped(null);
              }}
            >
              Choose another
            </Button>
          </div>
        </div>
      )}
      {dirty && !ask && (
        <div className="mb-2 flex items-center gap-2" data-testid="projects-unsaved">
          <StatusBadge status="unsaved" />
          <Button
            variant="primary"
            onClick={() => void commit(value)}
            data-field-action
            data-testid="setup-projects-save"
          >
            Save
          </Button>
          <Button onClick={() => setTyped(null)} data-field-action data-testid="projects-undo">
            Undo
          </Button>
        </div>
      )}
      {!dirty && !ask && saved && scan && (
        <div className="mb-2 flex items-center gap-2" data-testid="projects-saved">
          {justSaved && <StatusBadge status="saved" />}
          <Found scan={scan} />
        </div>
      )}
    </div>
  );
}
