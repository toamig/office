import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModuleInfo, SearchItem } from "../../shared/models";
import type { Workspace } from "../../shared/types";
import type { Provider } from "../modules/providers/types";
import type { Channel } from "./notifier";

export interface ModuleContext {
  name: string;
  dataDir: string;
  log: (message: string) => void;
  workspace: () => Workspace | null;
}

export interface SearchSource {
  id: string;
  items: () => Promise<SearchItem[]>;
}

type ModuleExport =
  | { kind: "channel"; create: (ctx: ModuleContext) => Channel | Promise<Channel> }
  | { kind: "provider"; create: (ctx: ModuleContext) => Provider | Promise<Provider> }
  | { kind: "source"; create: (ctx: ModuleContext) => SearchSource | Promise<SearchSource> };

export interface ModuleTargets {
  addChannel: (channel: Channel) => void;
  removeChannel: (id: string) => void;
  addProvider: (provider: Provider) => void;
  removeProvider: (id: string) => void;
}

export interface ModuleManagerDeps {
  dir: () => string;
  enabled: () => Record<string, boolean>;
  setEnabled: (name: string, enabled: boolean) => void;
  workspace: () => Workspace | null;
  targets: ModuleTargets;
  log?: (message: string) => void;
}

interface Loaded {
  kind: ModuleExport["kind"];
  unload: () => void;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Optional extra providers, vault sources and notification channels from `<data>/modules/<name>/index.mjs`.
 * Everything is off by default, and no module file is read as code until the owner enables it.
 */
export class ModuleManager {
  private readonly loaded = new Map<string, Loaded>();
  private readonly errors = new Map<string, string>();
  private readonly sources = new Map<string, SearchSource>();

  constructor(private readonly deps: ModuleManagerDeps) {}

  /** The sources of every enabled source module, for the quick switcher. */
  searchSources(): SearchSource[] {
    return [...this.sources.values()];
  }

  private manifest(name: string): { kind: string | null; description: string } {
    try {
      const raw = JSON.parse(readFileSync(join(this.deps.dir(), name, "module.json"), "utf8")) as {
        kind?: unknown;
        description?: unknown;
      };
      return {
        kind: typeof raw.kind === "string" ? raw.kind : null,
        description: typeof raw.description === "string" ? raw.description : "",
      };
    } catch {
      return { kind: null, description: "" };
    }
  }

  list(): ModuleInfo[] {
    const dir = this.deps.dir();
    if (!existsSync(dir)) return [];
    const flags = this.deps.enabled();
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() && NAME_RE.test(e.name) && existsSync(join(dir, e.name, "index.mjs")),
      )
      .map((e) => {
        const manifest = this.manifest(e.name);
        const loaded = this.loaded.get(e.name);
        const error = this.errors.get(e.name);
        return {
          name: e.name,
          kind: loaded?.kind ?? manifest.kind,
          description: manifest.description,
          enabled: flags[e.name] === true,
          loaded: loaded !== undefined,
          ...(error ? { error } : {}),
        };
      });
  }

  /** Loads every module the owner enabled. A module that fails is reported and skipped. */
  async loadEnabled(): Promise<void> {
    for (const info of this.list()) if (info.enabled) await this.load(info.name);
  }

  private makeContext(name: string): ModuleContext {
    const dataDir = join(this.deps.dir(), name, "data");
    mkdirSync(dataDir, { recursive: true });
    return {
      name,
      dataDir,
      log: (m) => this.deps.log?.(`[module ${name}] ${m}`),
      workspace: this.deps.workspace,
    };
  }

  private async load(name: string): Promise<void> {
    if (this.loaded.has(name)) return;
    this.errors.delete(name);
    try {
      const file = join(this.deps.dir(), name, "index.mjs");
      // A fresh URL each time, so enabling a module again after editing it runs the new code.
      const mod = (await import(
        /* @vite-ignore */ `${pathToFileURL(file).href}?v=${Date.now()}`
      )) as { default?: ModuleExport };
      const def = mod.default;
      if (!def || typeof def.create !== "function")
        throw new Error("index.mjs must export default { kind, create(ctx) }");
      const ctx = this.makeContext(name);
      if (def.kind === "channel") {
        const channel = await def.create(ctx);
        this.deps.targets.addChannel(channel);
        this.loaded.set(name, {
          kind: "channel",
          unload: () => this.deps.targets.removeChannel(channel.id),
        });
      } else if (def.kind === "provider") {
        const provider = await def.create(ctx);
        this.deps.targets.addProvider(provider);
        this.loaded.set(name, {
          kind: "provider",
          unload: () => this.deps.targets.removeProvider(provider.id),
        });
      } else if (def.kind === "source") {
        const source = await def.create(ctx);
        this.sources.set(name, source);
        this.loaded.set(name, { kind: "source", unload: () => void this.sources.delete(name) });
      } else {
        throw new Error(`Unknown module kind "${String((def as { kind?: unknown }).kind)}"`);
      }
    } catch (err) {
      this.errors.set(name, (err as Error).message);
    }
  }

  /** Turns a module on or off. Turning it off removes what it added. */
  async setEnabled(name: string, enabled: boolean): Promise<ModuleInfo[]> {
    if (!NAME_RE.test(name)) throw new Error("Bad module name");
    this.deps.setEnabled(name, enabled);
    if (enabled) await this.load(name);
    else {
      this.loaded.get(name)?.unload();
      this.loaded.delete(name);
      this.errors.delete(name);
    }
    return this.list();
  }
}
