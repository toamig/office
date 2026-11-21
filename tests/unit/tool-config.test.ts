import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolConfigService } from "../../src/main/modules/setup/tool-config";
import { tmp, write } from "../fixtures/repos/make";

let root: string;
let tools: ToolConfigService;
beforeEach(() => {
  root = tmp("office-tool-config-");
  tools = new ToolConfigService({
    home: () => join(root, "home"),
    project: (id) => id === "alpha" ? join(root, "alpha") : undefined,
    backups: () => join(root, "backups"),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("tool configuration", () => {
  it("previews a Codex disable, preserves unrelated TOML and backs up the exact original", () => {
    const path = "home/.codex/config.toml";
    const before = '# Keep this comment\nmodel = "existing"\n\n[mcp_servers.fixture]\ncommand = "fixture"\n\n[features]\nmemories = false\n';
    write(root, path, before);
    const entry = tools.list().find((item) => item.name === "fixture")!;
    const preview = tools.preview({ action: "disable", id: entry.id });
    expect(readFileSync(join(root, path), "utf8")).toBe(before);
    expect(preview.changes[0]?.diff).toContain("+ enabled = false");
    tools.apply(preview.id);
    expect(tools.list().find((item) => item.id === entry.id)?.disabled).toBe(true);
    expect(readFileSync(join(root, path), "utf8")).toContain("[features]\nmemories = false");
    const backup = join(root, "backups", preview.id);
    expect(readFileSync(join(backup, readdirSync(backup)[0]!), "utf8")).toBe(before);
  });

  it("moves precisely one Claude hook to a project and leaves the other hook in place", () => {
    const command = (name: string) => ({ type: "command", command: name });
    write(root, "home/.claude/settings.json", JSON.stringify({
      model: "example", hooks: { Stop: [{ matcher: "fixture", hooks: [command("one"), command("two")] }] },
    }));
    const source = tools.list().find((item) => item.detail === "one")!;
    const preview = tools.preview({ action: "move", id: source.id, destination: "alpha" });
    expect(preview.changes).toHaveLength(3);
    tools.apply(preview.id);
    expect(tools.list().map((item) => item.detail)).toEqual(["two"]);
    expect(tools.list("alpha").find((item) => item.detail === "one")?.projectId).toBe("alpha");
    expect(JSON.parse(readFileSync(join(root, "home/.claude/settings.json"), "utf8")).model).toBe("example");
  });

  it("rejects stale previews without changing the new configuration", () => {
    write(root, "home/.claude.json", '{"mcpServers":{"fixture":{"command":"old"}}}');
    const preview = tools.preview({ action: "remove", id: tools.list()[0]!.id });
    write(root, "home/.claude.json", '{"mcpServers":{"fixture":{"command":"new"}}}');
    expect(() => tools.apply(preview.id)).toThrow(/changed after/);
    expect(readFileSync(join(root, "home/.claude.json"), "utf8")).toContain('"new"');
    expect(existsSync(join(root, "backups"))).toBe(false);
  });

  it("copies a skill with its assets after review and backs it up on removal", () => {
    write(root, "source/fake-skill/SKILL.md", "# My skill");
    write(root, "source/fake-skill/references/source.txt", "source material");
    const add = tools.preview({
      action: "add", provider: "codex", kind: "skill", projectId: "alpha", name: "",
      value: join(root, "source/fake-skill"),
    });
    const file = join(root, "alpha/.agents/skills/fake-skill/references/source.txt");
    expect(existsSync(file)).toBe(false);
    tools.apply(add.id);
    expect(readFileSync(file, "utf8")).toBe("source material");
    const remove = tools.preview({ action: "remove", id: tools.list("alpha")[0]!.id, projectId: "alpha" });
    tools.apply(remove.id);
    expect(existsSync(file)).toBe(false);
    const backup = join(root, "alpha/.agents/.office-skill-backups");
    expect(readFileSync(join(backup, readdirSync(backup)[0]!, "references/source.txt"), "utf8")).toBe("source material");
  });
});
