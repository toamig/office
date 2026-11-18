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
 * Fills `{{task.description}}`-style placeholders by simple replacement. A placeholder that has no
 * value is an error (naming it), never an empty string.
 */
export function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = lookup(ctx, key);
    if (value === undefined || value === null || value === "") {
      throw new Error(`Unknown placeholder {{${key}}} in the stage prompt`);
    }
    return String(value);
  });
}
