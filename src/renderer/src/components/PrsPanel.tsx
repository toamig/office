import { ExternalLink } from "lucide-react";
import { useQuery } from "../lib/hooks";
import { Banner, Card, EmptyState, Group, StatusBadge } from "../ui";

/** A CI run's result as one of the shared statuses. */
const runStatus = (conclusion: string | null, status: string): string =>
  conclusion === "success"
    ? "passed"
    : conclusion === "failure"
      ? "failed"
      : status === "completed"
        ? "cancelled"
        : "running";

const REVIEW: Record<string, [string, string]> = {
  APPROVED: ["done", "Approved"],
  CHANGES_REQUESTED: ["failed", "Changes requested"],
  REVIEW_REQUIRED: ["waiting", "Review needed"],
};

/** Open pull requests with their review state, and the last CI runs, with links out to GitHub. */
export function PrsPanel({ projectId }: { projectId: string }) {
  const overview = useQuery("github.overview", { projectId }, ["project.status"]);
  const d = overview.data;
  return (
    <Card title="Pull requests and CI" testId="panel-prs">
      <div data-testid="prs-panel">
        {overview.error && <Banner tone="danger">{overview.error}</Banner>}
        {d && !d.isGithub && (
          <EmptyState title="Not on GitHub">
            This repo is not on GitHub, so there are no pull requests or CI runs to show.
          </EmptyState>
        )}
        {d?.error && <Banner tone="attention">GitHub could not be reached: {d.error}</Banner>}
        {d?.isGithub && !d.error && (
          <>
            <Group>Open pull requests</Group>
            {d.prs.length === 0 && <p className="ui-muted m-0">No open pull requests.</p>}
            {d.prs.map((pr) => {
              const review = pr.reviewDecision ? REVIEW[pr.reviewDecision] : undefined;
              return (
                <div key={pr.number} className="ui-line" data-testid="pr-row">
                  <div className="ui-line-main">
                    <span className="ui-muted num">#{pr.number}</span> {pr.title}
                    <div className="ui-line-sub">
                      <code>{pr.headRefName}</code>
                    </div>
                  </div>
                  {pr.reviewDecision && (
                    <StatusBadge
                      status={review?.[0] ?? "waiting"}
                      label={
                        review?.[1] ??
                        pr.reviewDecision
                          .toLowerCase()
                          .replace(/_/g, " ")
                          .replace(/^./, (c) => c.toUpperCase())
                      }
                    />
                  )}
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open pull request ${pr.number}`}
                    title={`Open pull request ${pr.number}`}
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              );
            })}
            <Group>Recent CI runs</Group>
            {d.runs.length === 0 && <p className="ui-muted m-0">No CI runs yet.</p>}
            {d.runs.map((run) => (
              <div key={run.url} className="ui-line" data-testid="run-row">
                <div className="ui-line-main">
                  {run.name}
                  <div className="ui-line-sub">
                    <code>{run.headBranch}</code>
                  </div>
                </div>
                <StatusBadge status={runStatus(run.conclusion, run.status)} />
                <a
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open run ${run.name}`}
                  title={`Open run ${run.name}`}
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}
