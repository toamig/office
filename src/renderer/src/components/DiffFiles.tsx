import type { DiffFile } from "@shared/models";

/** The changed files of a diff, each with its added and removed lines; a few files start open. */
export function DiffFiles({ files, testId }: { files: DiffFile[]; testId?: string }) {
  return (
    <div data-testid={testId}>
      {files.map((f) => (
        <details key={f.path} className="mb-2" open={files.length <= 3}>
          <summary className="font-medium">
            {f.path}{" "}
            <span className="ui-muted">
              +{f.additions} -{f.deletions}
            </span>
          </summary>
          <div className="font-mono text-[length:var(--text-sm)]">
            {f.hunks.flatMap((h) =>
              h.lines.map((l, i) => (
                <div
                  key={`${h.header}-${i}`}
                  className="whitespace-pre-wrap break-all px-2"
                  data-diff={l.kind}
                >
                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} {l.text}
                </div>
              )),
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
