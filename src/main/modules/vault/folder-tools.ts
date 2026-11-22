import { folderRouterEdits, replaceGenerated, validateFolderBrain } from "./folder-brain";
import { notesPath } from "./scope";
import type { VaultWriter } from "./writer";
import { readRulePack, runRuleTool } from "./rule-pack";
import { commitStarterFiles } from "./starter-pack";
import { git } from "../git/run";

export class FolderTools {
  constructor(private readonly deps: {
    root: () => string; folders: () => string[]; enabled: () => boolean; writer: VaultWriter;
  }) {}

  enabled(): boolean {
    return this.deps.enabled() && Boolean(this.deps.root());
  }

  validate(root = this.deps.root()) {
    return validateFolderBrain(root, this.deps.folders());
  }

  async reindex(): Promise<number> {
    const root = this.deps.root();
    if (!this.enabled()) throw new Error("Built-in reindex is available for folder brains.");
    if (readRulePack(root)?.tools.reindex) return this.reindexWithPack(root);
    let count = 0;
    for (const item of folderRouterEdits(root, this.deps.folders())) {
      const path = notesPath(root, item.path);
      if (!path) throw new Error("A router is outside the brain.");
      const initial = () => item.initial;
      if (replaceGenerated(item.before || initial(), item.generated) === item.before) continue;
      const result = await this.deps.writer.edit(path, "Refresh Brain router", (text) =>
        replaceGenerated(text, item.generated), initial, () => {
          if (this.deps.root() !== root || !this.enabled() || notesPath(root, item.path) !== path)
            throw new Error("The brain changed during reindex.");
        });
      if (result.committed) count++;
    }
    return count;
  }

  private reindexWithPack(root: string): Promise<number> {
    return this.deps.writer.exclusive(async () => {
      if (root !== this.deps.root()) throw new Error("The Brain changed during reindex.");
      const routers = ["_index.md", ":(glob)**/_index.md"];
      const dirty = await git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...routers]);
      if (dirty.code !== 0 || dirty.stdout.trim()) throw new Error("Save or discard pending router changes before reindexing.");
      const result = await runRuleTool(root, "reindex", 120_000);
      if (!result || result.code !== 0) throw new Error(result?.stderr.trim() || result?.stdout.trim() || "Brain reindex failed.");
      const [modified, added] = await Promise.all([
        git(root, ["diff", "HEAD", "--name-only", "-z", "--", ...routers]),
        git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...routers]),
      ]);
      if (modified.code !== 0 || added.code !== 0) throw new Error("Could not list the generated routers.");
      const paths = [...new Set((modified.stdout + added.stdout).split("\0").filter(Boolean))];
      await commitStarterFiles(root, paths, "Refresh Brain routers");
      return paths.length;
    });
  }
}
