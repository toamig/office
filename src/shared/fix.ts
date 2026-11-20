import type { FixSubject } from "./models";

/**
 * The key a problem is tracked by while a session fixes it. A pending item keeps its own key, so the bell, Home and
 * Needs you all agree; the other kinds get a stable key made from what the problem says. The main process and the
 * screens both call this, so a button knows which session is fixing its problem.
 */
export function fixKeyOf(subject: FixSubject): string {
  switch (subject.type) {
    case "pending":
    case "problem":
      return subject.key;
    case "validate":
      return `validate:${subject.message}`;
    case "repo":
      return `repo:${subject.folder}`;
    case "audit":
      return `audit:${subject.repo}:${subject.entry}`;
    case "warning":
      return `warning:${subject.message}`;
    case "error":
      return `error:${subject.title}:${subject.projectId ?? subject.folder ?? ""}`;
  }
}
