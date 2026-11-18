/** A value looked up by a dotted path in nested objects, or undefined. */
function lookup(ctx: unknown, path: string): unknown {
  let value: unknown = ctx;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * Fills `{{task.description}}`-style placeholders by simple replacement. A placeholder that is not
 * known (or has no value yet, like a branch before the worktree exists) is an error naming it.
 */
export function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = lookup(ctx, key);
    if (value === undefined || value === null) {
      throw new Error(`Unknown placeholder {{${key}}} in the stage prompt`);
    }
    return String(value);
  });
}
