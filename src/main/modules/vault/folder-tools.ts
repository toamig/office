import { folderRouterEdits, replaceGenerated, validateFolderBrain } from "./folder-brain";
import { notesPath } from "./scope";
import type { VaultWriter } from "./writer";

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
}
