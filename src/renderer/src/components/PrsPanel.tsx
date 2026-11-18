import { ExternalLink } from "lucide-react";
import { useQuery } from "../lib/hooks";
import { Chip, EmptyState, ErrorBanner, Panel } from "./ui";

const toneOf = (conclusion: string | null, status: string): "good" | "bad" | "warn" | "neutral" =>
  conclusion === "success"
    ? "good"
    : conclusion === "failure"
      ? "bad"
      : status === "completed"
        ? "neutral"
        : "warn";

/** Open pull requests with their review state, and the last CI runs, with links out to GitHub. */
export function PrsPanel({ projectId }: { projectId: string }) {
  const overview = useQuery("github.overview", { projectId });
  const d = overview.data;
  return (
    <Panel title="Pull requests and CI">
      <div data-testid="prs-panel">
        {overview.error && <ErrorBanner message={overview.error} />}
        {d && !d.isGithub && (
          <EmptyState>
            This repo is not on GitHub, so there are no pull requests or CI runs to show.
          </EmptyState>
        )}
        {d?.error && <ErrorBanner message={`GitHub could not be reached: ${d.error}`} />}
        {d?.isGithub && !d.error && (
          <>
            <h3 className="m-0 mb-1 text-[13px] font-semibold">Open pull requests</h3>
            {d.prs.length === 0 && <EmptyState>No open pull requests.</EmptyState>}
            {d.prs.map((pr) => (
              <div key={pr.number} className="flex items-center gap-2 py-1" data-testid="pr-row">
                <span style={{ color: "var(--muted)" }}>#{pr.number}</span>
                <span className="flex-1">{pr.title}</span>
                <Chip>{pr.headRefName}</Chip>
                {pr.reviewDecision && (
                  <Chip
                    tone={
                      pr.reviewDecision === "APPROVED"
                        ? "good"
                        : pr.reviewDecision === "CHANGES_REQUESTED"
                          ? "bad"
                          : "warn"
                    }
                  >
                    {pr.reviewDecision.toLowerCase().replace(/_/g, " ")}
                  </Chip>
                )}
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open pull request ${pr.number}`}
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            ))}
            <h3 className="mb-1 mt-3 text-[13px] font-semibold">Recent CI runs</h3>
            {d.runs.length === 0 && <EmptyState>No CI runs yet.</EmptyState>}
            {d.runs.map((run) => (
              <div key={run.url} className="flex items-center gap-2 py-1" data-testid="run-row">
                <span className="flex-1">{run.name}</span>
                <Chip>{run.headBranch}</Chip>
                <Chip tone={toneOf(run.conclusion, run.status)}>
                  {run.conclusion ?? run.status}
                </Chip>
                <a
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open run ${run.name}`}
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            ))}
          </>
        )}
      </div>
    </Panel>
  );
}
