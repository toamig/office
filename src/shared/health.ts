import type { HealthView } from "./models";

/** The checks in words: "Checks pass. 3 warnings" or "Checks fail. 2 errors, 3 warnings". */
export function describeValidate(v: HealthView["validate"]): string {
  const count = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;
  const parts = [
    ...(v.errors.length > 0 ? [count(v.errors.length, "error")] : []),
    ...(v.warnings > 0 ? [count(v.warnings, "warning")] : []),
  ];
  const head = v.ok ? "Checks pass" : "Checks fail";
  return parts.length > 0 ? `${head}. ${parts.join(", ")}` : `${head}.`;
}

/** The goal of a session started to fix a problem: "Fix: Polyglyph pricing notes disagree", at most ~70 characters. */
export function fixGoal(problem: string): string {
  const clean = problem
    .replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const text = clean.length > 70 ? `${clean.slice(0, 67).trimEnd()}...` : clean;
  return `Fix: ${text}`;
}
