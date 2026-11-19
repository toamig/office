/**
 * One table decides how every status, result and badge in the app is coloured (plan DesignSystem 1: tone follows
 * meaning). Good outcomes are success, grey only means inactive or neutral, amber only means the owner should act
 * soon, red only means a failure or something broken. A test covers every value the app can show.
 */

export type Tone = "success" | "working" | "info" | "attention" | "danger" | "neutral";

/** The icon a badge shows with its word. */
export type StatusIcon = "check" | "spinner" | "attention" | "cross" | "dot" | "clock" | "info";

interface Entry {
  tone: Tone;
  /** Sentence case, the word the owner reads. */
  label: string;
}

const t = (tone: Tone, label: string): Entry => ({ tone, label });

/** Every status the app can show, by the value it has in the code. */
export const STATUS: Record<string, Entry> = {
  // Agent sessions
  starting: t("working", "Starting"),
  working: t("working", "Working"),
  "needs-you": t("attention", "Needs you"),
  idle: t("neutral", "Idle"),
  exited: t("neutral", "Ended"),
  failed: t("danger", "Failed"),
  // Tasks and their stages
  running: t("working", "Running"),
  "waiting-gate": t("attention", "Waiting for you"),
  "waiting-permission": t("attention", "Waiting for you"),
  done: t("success", "Done"),
  cancelled: t("neutral", "Cancelled"),
  pending: t("neutral", "Not started"),
  // Syncing
  pulled: t("success", "Pulled"),
  pushed: t("success", "Pushed"),
  "pulled-and-pushed": t("success", "Pulled and pushed"),
  "up-to-date": t("success", "Up to date"),
  conflict: t("danger", "Conflict"),
  skipped: t("neutral", "Skipped"),
  behind: t("attention", "Behind"),
  ahead: t("info", "Ahead"),
  // Setup and tools
  installed: t("success", "Installed"),
  "not-installed": t("attention", "Not installed"),
  "logged-in": t("success", "Logged in"),
  "not-logged-in": t("attention", "Not logged in"),
  missing: t("danger", "Missing"),
  "update-available": t("attention", "Update available"),
  // Results and states of things
  "in-sync": t("success", "In sync"),
  saved: t("success", "Saved"),
  unsaved: t("attention", "Not saved yet"),
  passed: t("success", "Passed"),
  archived: t("neutral", "Archived"),
  "folder-missing": t("danger", "Folder missing"),
  "not-a-repo": t("attention", "Not a git repo"),
  waiting: t("attention", "Waiting"),
  info: t("info", "Info"),
};

/** The tone of a status. A value the table does not know is neutral, and a test keeps every real value in the table. */
export function toneOf(status: string): Tone {
  return STATUS[status]?.tone ?? "neutral";
}

/** The word to show for a status, in sentence case. */
export function labelOf(status: string): string {
  return (
    STATUS[status]?.label ?? status.charAt(0).toUpperCase() + status.slice(1).replaceAll("-", " ")
  );
}

/** The icon that goes with a tone, so colour is never the only signal. */
export function iconOf(tone: Tone, status?: string): StatusIcon {
  if (status === "idle" || status === "archived" || status === "pending") return "dot";
  if (status === "waiting" || status === "waiting-gate" || status === "waiting-permission")
    return "clock";
  switch (tone) {
    case "success":
      return "check";
    case "working":
      return "spinner";
    case "attention":
      return "attention";
    case "danger":
      return "cross";
    case "info":
      return "info";
    default:
      return "dot";
  }
}
