import { resolve } from "node:path";
/** Runs `fn` over `items` with at most `limit` running at once. Results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Returns a debounced version of `fn`: it runs once, `ms` after the last call. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: NodeJS.Timeout | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * A project's folder on this PC: the path this PC was told for that project, else its path under the projects
 * folder. The workspace config holds the relative path (it travels); the exception stays on the machine.
 */
export function projectFolder(
  projectsRoot: string,
  project: { id: string; path: string },
  overrides: Record<string, string> = {},
): string {
  const own = overrides[project.id];
  return own ? resolve(own) : resolve(projectsRoot, project.path);
}

export const nowIso = (): string => new Date().toISOString();

/** A path in a form that compares equal across slash styles and letter case (for folder identity). */
export function normPath(p: string): string {
  return p
    .replace(/[\\/]+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}
