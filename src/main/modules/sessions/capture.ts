import { z } from "zod";
import type { CaptureResult } from "../../../shared/models";
import type { ProviderRegistry } from "../providers/registry";
import type { RunService } from "../runs/service";
import type { SessionService } from "./service";

export const CAPTURE_PROMPT =
  "List, as JSON {items:[{text, kind:'waiting'|'todo'}]}, what is left undone or waiting on the owner from this session. Return [] if nothing.";

const Items = z.object({
  items: z.array(z.object({ text: z.string(), kind: z.enum(["waiting", "todo"]).catch("todo") })),
});

/** Pulls the first JSON value out of model output, tolerating code fences and chatter around it. */
export function parseCaptureOutput(
  text: string,
): Array<{ text: string; kind: "waiting" | "todo" }> {
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const close = text[start] === "{" ? "}" : "]";
    const end = text.lastIndexOf(close);
    if (end > start) candidates.push(text.slice(start, end + 1));
  }
  candidates.push(text);
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (Array.isArray(value)) {
        return value.flatMap((v) =>
          typeof v === "string" && v.trim() ? [{ text: v, kind: "todo" as const }] : [],
        );
      }
      const parsed = Items.safeParse(value);
      if (parsed.success) return parsed.data.items.filter((i) => i.text.trim());
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/** End-of-session capture (plan M2.5): ask the tool what is left, so it lands in the notes. */
export async function captureSession(
  deps: { sessions: SessionService; runs: RunService; providers: ProviderRegistry },
  sessionId: string,
): Promise<CaptureResult> {
  const session = deps.sessions.get(sessionId);
  // The terminal must be closed first: two processes must not drive one conversation.
  await deps.sessions.stop(sessionId);
  const provider = deps.providers.get(session.provider);
  if (!provider?.canResumeHeadless) return { supported: false, items: [], runId: null };
  const handle = deps.runs.start({
    kind: "capture",
    providerId: provider.id,
    role: { provider: provider.id, instructions: "", readOnly: true, allowedCommands: [] },
    cwd: session.cwd,
    prompt: CAPTURE_PROMPT,
    resumeId: session.providerSessionId ?? session.id,
    ...(session.projectId ? { projectId: session.projectId } : {}),
  });
  const result = await handle.result;
  if (!result.ok) {
    return {
      supported: true,
      items: [],
      runId: handle.id,
      error: result.error ?? "The capture run failed",
    };
  }
  return { supported: true, items: parseCaptureOutput(result.resultText), runId: handle.id };
}
