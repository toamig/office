import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Manifest = z.object({
  repos: z.array(z.object({ folder: z.string(), repo: z.string() })),
});
const BrainJson = z.object({
  description: z.string().optional(),
  depends: z.array(z.object({ folder: z.string(), repo: z.string() })).default([]),
});

export interface HubRepo {
  folder: string;
  repo: string;
  description: string;
  depends: string[];
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Lists the nested repos of a brain hub from brain.repos.json, enriched from each brain.json. */
export function readHub(root: string): HubRepo[] {
  const manifest = Manifest.safeParse(readJson(join(root, "brain.repos.json")));
  if (!manifest.success) return [];
  return manifest.data.repos.map((entry) => {
    const brain = BrainJson.safeParse(readJson(join(root, entry.folder, "brain.json")));
    return {
      folder: entry.folder,
      repo: entry.repo,
      description: brain.success ? (brain.data.description ?? "") : "",
      depends: brain.success ? brain.data.depends.map((d) => d.folder) : [],
    };
  });
}

/** Absolute path of the OpenItems file of a vault folder. */
export function openItemsPath(root: string, vaultFolder: string, file: string): string {
  return join(root, vaultFolder, file);
}

export const hasHubTool = (root: string): boolean => existsSync(join(root, "tools", "hub.mjs"));
