import { useState } from "react";
import type { HealthProblem, HubRepoRow } from "@shared/models";
import { DiffFiles } from "./DiffFiles";
import { BeingFixed, FixButton, useFixMenuItem } from "./Fix";
import { fixAction } from "../lib/fix";
import { office } from "../lib/ipc";
import { useQuery } from "../lib/hooks";
import { NoteText } from "../views/project/Notes";
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  Input,
  LinkButton,
  OverflowMenu,
  StatusBadge,
  notifyDone,
  notifyError,
} from "../ui";

/** The uncommitted files of a brain repo with their changes; Commit takes them all, Discard throws them away (asking first). */
function ChangesDialog({ folder, onClose }: { folder: string; onClose: () => void }) {
  const changes = useQuery("health.changes", { folder });
  const [message, setMessage] = useState("Update notes");
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const files = changes.data?.files ?? [];
  const finish = async (
    work: () => Promise<unknown>,
    done: string,
    failed: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      await work();
      notifyDone(done, undefined, "health");
      onClose();
    } catch (err) {
      notifyError(err, failed, "health");
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        title={`Uncommitted changes in ${folder === "." ? "the hub" : folder}`}
        testId="health-changes"
        wide
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="danger"
              disabled={busy || files.length === 0}
              onClick={() => setSure(true)}
              data-testid="health-discard"
            >
              Discard
            </Button>
            <Button
              variant="primary"
              disabled={busy || files.length === 0 || !message.trim()}
              onClick={() =>
                void finish(
                  () => office.invoke("health.commit", { folder, message }),
                  "Committed",
                  "Could not commit those changes",
                )
              }
              data-testid="health-commit"
            >
              Commit
            </Button>
          </>
        }
      >
        {changes.error && <Banner tone="danger">{changes.error}</Banner>}
        {changes.data && files.length === 0 && (
          <EmptyState title="Nothing is uncommitted">
            Everything in this repo is committed.
          </EmptyState>
        )}
        <DiffFiles files={files} testId="health-files" />
        <Input
          label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          data-testid="health-message"
        />
      </Dialog>
      {sure && (
        <Dialog
          title="Discard these changes?"
          testId="health-discard-confirm"
          onClose={() => setSure(false)}
          footer={
            <>
              <Button onClick={() => setSure(false)}>Keep them</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void finish(
                    () => office.invoke("health.discard", { folder }),
                    "Changes discarded",
                    "Could not discard those changes",
                  )
                }
                data-testid="health-discard-yes"
              >
                Discard {files.length} {files.length === 1 ? "file" : "files"}
              </Button>
            </>
          }
        >
          <p className="m-0">
            The changed files go back to how they were at the last commit and new files are removed.
            This cannot be undone.
          </p>
        </Dialog>
      )}
    </>
  );
}

/** A brain repo that needs attention, with the one thing to do about it. */
export function RepoItem({ repo }: { repo: HubRepoRow }) {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = repo.folder === "." ? "Hub" : repo.folder;
  const subject = { type: "repo", folder: repo.folder, state: repo.state } as const;
  const fixItem = useFixMenuItem(subject);
  const act = async (work: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    setBusy(true);
    try {
      await work();
      notifyDone(done, name, "health");
    } catch (err) {
      notifyError(err, failed, "health", fixAction(failed, err, { folder: repo.folder }));
    } finally {
      setBusy(false);
    }
  };
  // One action per item: commit what is uncommitted first; then pull; then push; else a session.
  let action: React.ReactNode;
  if (repo.uncommitted > 0)
    action = (
      <Button size="sm" onClick={() => setReviewing(true)} data-testid="health-review">
        Review changes
      </Button>
    );
  else if (repo.behind > 0)
    action = (
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          void act(
            () => office.invoke("health.pull", { folder: repo.folder }),
            "Brought up to date",
            `Could not pull ${name}`,
          )
        }
        data-testid="health-pull"
      >
        Pull
      </Button>
    );
  else if (repo.ahead > 0)
    action = (
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          void act(
            () => office.invoke("health.push", { folder: repo.folder }),
            "Pushed",
            `Could not push ${name}`,
          )
        }
        data-testid="health-push"
      >
        Push
      </Button>
    );
  else action = <FixButton subject={subject} />;
  // Office's own fix stays the main button; a session to fix it another way sits in the item's menu.
  const safe = repo.uncommitted > 0 || repo.behind > 0 || repo.ahead > 0;
  return (
    <div className="ui-line" data-testid="health-repo" data-repo={repo.folder}>
      <StatusBadge status="behind" label={name} />
      <span className="ui-line-main">{repo.state}</span>
      {safe && fixItem.entry && <BeingFixed entry={fixItem.entry} />}
      {action}
      {safe && fixItem.item && (
        <OverflowMenu
          label="More for this repo"
          testId="health-repo-more"
          floating
          items={[fixItem.item]}
        />
      )}
      {reviewing && <ChangesDialog folder={repo.folder} onClose={() => setReviewing(false)} />}
    </div>
  );
}

/** One finding of the brain's check, as formatted text, with the one thing to do about it. */
export function ProblemItem({ problem }: { problem: HealthProblem }) {
  return (
    <div className="ui-line" data-testid="health-problem" data-level={problem.level}>
      <StatusBadge
        status="info"
        tone={problem.level === "error" ? "danger" : "attention"}
        label={problem.level === "error" ? "Problem" : "Warning"}
      />
      <div className="ui-line-main">
        <NoteText>{problem.message}</NoteText>
      </div>
      <FixButton
        subject={{
          type: "validate",
          message: problem.message,
          file: problem.file ?? null,
          repo: problem.repo ?? null,
        }}
      />
    </div>
  );
}

/** A content-audit entry as formatted text, with its note links clickable, and a session to fix it. */
export function AuditItem({ repo, entry }: { repo: string; entry: string }) {
  return (
    <div className="ui-line" data-testid="audit-entry">
      <div className="ui-line-main">
        <NoteText>{entry}</NoteText>
      </div>
      <FixButton subject={{ type: "audit", repo, entry }} />
    </div>
  );
}

/** The raw output of a tool, one click away. */
export function ShowDetails({
  output,
  label = "Show details",
}: {
  output: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!output) return null;
  return (
    <div className="pt-1">
      <LinkButton onClick={() => setOpen(!open)} data-testid="health-details">
        {open ? "Hide details" : label}
      </LinkButton>
      {open && (
        <pre className="ui-codeblock mt-1" data-testid="health-output">
          {output}
        </pre>
      )}
    </div>
  );
}
