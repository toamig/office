import { z } from "zod";
import type { ChatModel } from "../../../shared/models";
import { spawnStream } from "../../core/exec";
import type { CommandSpec } from "./types";

export function claudeChatModel(id: string): ChatModel {
  const match = /(?:^|claude-)(opus|sonnet|haiku|fable)(?:-(\d)(?:-(\d))?)?/i.exec(id);
  const family = match?.[1];
  const version = match?.[2] ? [match[2], match[3]].filter(Boolean).join(".") : "";
  const label = family ? `${family[0]!.toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ""}` : id;
  const common = ["low", "medium", "high"];
  const efforts = version === "4.6" && (family === "opus" || family === "sonnet")
    ? [...common, "max"]
    : family === "fable" || (family !== "haiku" && ["4.7", "4.8", "5"].includes(version)) || version === "5.5"
      ? [...common, "xhigh", "max"] : [];
  return { id, label, efforts };
}

const claudeModelInfo = z.object({
  value: z.string(),
  displayName: z.string(),
  supportedEffortLevels: z.array(z.string()).optional(),
});

export function claudeModelCatalog(data: unknown): ChatModel[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry): ChatModel[] => {
    const info = claudeModelInfo.safeParse(entry);
    if (!info.success || info.data.value === "default") return [];
    const { value, displayName, supportedEffortLevels } = info.data;
    return [{ id: value, label: displayName, efforts: supportedEffortLevels ?? claudeChatModel(value).efforts }];
  });
}

const modelPage = z.object({
  data: z.array(z.object({
    model: z.string(), displayName: z.string(), isDefault: z.boolean(),
    supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })),
  })),
  nextCursor: z.string().nullable().optional(),
});

export async function codexChatModels(command: CommandSpec, cwd: string, configured?: string) {
  const stream = spawnStream(command.cmd, command.args, { cwd, keepStdin: true });
  const deadline = setTimeout(() => stream.kill(), 5000);
  const send = (method: string, params?: object, id?: number) =>
    stream.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
  const models: ChatModel[] = [];
  let defaultModel: ChatModel | undefined;
  try {
    send("initialize", { clientInfo: { name: "office", version: "0.1.0" } }, 1);
    for await (const line of stream.lines) {
      try {
        const response = JSON.parse(line);
        if (response.id === 1) {
          if (response.error) break;
          send("initialized");
          send("config/read", { cwd }, 2);
          send("model/list", { limit: 100 }, 3);
        } else if (response.id === 2) {
          const model = response.result?.config?.model;
          if (typeof model === "string" && model) configured = model;
        } else if (response.id === 3) {
          const page = modelPage.safeParse(response.result);
          if (!page.success) break;
          for (const item of page.data.data) {
            const model = { id: item.model, label: item.displayName, efforts: item.supportedReasoningEfforts.map((entry) => entry.reasoningEffort) };
            models.push(model);
            if (item.isDefault) defaultModel = model;
          }
          if (!page.data.nextCursor) break;
          send("model/list", { limit: 100, cursor: page.data.nextCursor }, 3);
        }
      } catch { /* Ignore startup output outside the protocol. */ }
    }
  } finally {
    clearTimeout(deadline);
    stream.kill();
  }
  return { models, defaultModel: configured
    ? models.find((model) => model.id === configured) ?? { id: configured, label: configured, efforts: [] }
    : defaultModel };
}
