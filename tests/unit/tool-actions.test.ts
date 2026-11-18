import { describe, expect, it } from "vitest";
import {
  installTool,
  loginTool,
  INSTALL_COMMANDS,
} from "../../src/main/modules/setup/tool-actions";
import type { CommandSpec } from "../../src/main/modules/providers/types";

function deps() {
  const opened: Array<{ spec: CommandSpec; title: string }> = [];
  const logins: string[] = [];
  return {
    opened,
    logins,
    value: {
      providers: {
        get: (id: string) =>
          id === "claude-code" || id === "codex"
            ? ({
                login: async () => {
                  logins.push(id);
                },
              } as never)
            : undefined,
      },
      startCommand: (spec: CommandSpec, title: string) => {
        opened.push({ spec, title });
      },
    },
  };
}

describe("Setup tool actions", () => {
  it("opens a provider's own login, and GitHub's login in a terminal tab", async () => {
    const d = deps();
    await loginTool(d.value, "claude-code");
    await loginTool(d.value, "codex");
    expect(d.logins).toEqual(["claude-code", "codex"]);
    await loginTool(d.value, "gh");
    expect(d.opened).toHaveLength(1);
    expect(d.opened[0]?.title).toBe("GitHub login");
    expect(JSON.stringify(d.opened[0]?.spec.args)).toContain("login");
    await expect(loginTool(d.value, "git")).rejects.toThrow(/no login/);
  });

  it("offers an install only where Office has a command, and runs it in a visible terminal", () => {
    const d = deps();
    expect(Object.keys(INSTALL_COMMANDS)).toEqual(["codex"]);
    installTool(d.value, "codex");
    expect(d.opened[0]?.title).toBe("Install Codex");
    expect(JSON.stringify(d.opened[0]?.spec.args)).toContain("@openai/codex");
    expect(() => installTool(d.value, "claude-code")).toThrow(/no install command/);
    expect(() => installTool(d.value, "git")).toThrow(/no install command/);
  });
});
