import { z } from "zod";
import type { RequestResult } from "../../../shared/models";
import type { Workspace } from "../../../shared/types";
import { IpcFailure } from "../../core/ipc";

const Route = z.object({ projectId: z.string().nullable() });

export function reminderDate(date: string | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new IpcFailure("reminder-date", "Say which day you want the reminder.");
  const selected = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(selected.valueOf()) || selected.toISOString().slice(0, 10) !== date)
    throw new IpcFailure("reminder-date", "That reminder date is invalid.");
  return date;
}

interface RouterDeps {
  workspace: () => Workspace | null;
  complete: (prompt: string) => Promise<string>;
  enabled: () => boolean;
  chat: (request: string, projectId?: string) => string;
}

export class RequestRouter {
  constructor(private readonly deps: RouterDeps) {}

  async route(request: string, projectId?: string): Promise<RequestResult> {
    const target = projectId ?? (this.deps.enabled() ? await this.projectFor(request) : undefined);
    return {
      message: "Opened a chat.",
      link: { view: "explore", params: { chat: this.deps.chat(request, target) } },
    };
  }

  private async projectFor(request: string): Promise<string | undefined> {
    const projects = this.deps.workspace()?.projects.filter((project) => !project.archived) ?? [];
    if (!projects.length) return undefined;
    try {
      const reply = await this.deps.complete([
        'Choose the single existing project explicitly concerned by the request. Return only {"projectId":null} or its exact ID.',
        `Projects ${JSON.stringify(projects.map(({ id, name }) => ({ id, name })))}`,
        `Request ${JSON.stringify(request)}`,
      ].join("\n"));
      const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(reply.trim());
      const route = Route.parse(JSON.parse(fenced?.[1] ?? reply.trim()));
      return projects.find((project) => project.id === route.projectId)?.id;
    } catch {
      return undefined;
    }
  }
}
