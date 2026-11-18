import { resolveCommand, resolveTool } from "../../core/exec";
import { IpcFailure } from "../../core/ipc";
import type { ProviderRegistry } from "../providers/registry";
import type { CommandSpec } from "../providers/types";

export interface ToolActionDeps {
  providers: Pick<ProviderRegistry, "get">;
  /** Opens a command in a terminal tab, where the owner sees it run and answers its prompts. */
  startCommand: (spec: CommandSpec, title: string) => void;
}

/** The commands Office can offer to run for a missing tool. Everything else is a link in the "Fix" text. */
export const INSTALL_COMMANDS: Record<string, { label: string; cmd: string; args: string[] }> = {
  codex: { label: "Codex", cmd: "npm", args: ["i", "-g", "@openai/codex"] },
};

const commandSpec = (cmd: string, args: string[]): CommandSpec => {
  const resolved = resolveCommand(resolveTool(cmd) ?? cmd, args);
  return { cmd: resolved.file, args: resolved.args };
};

/** Opens the tool's own login in a terminal tab. Office never sees the password or token. */
export async function loginTool(deps: ToolActionDeps, id: string): Promise<void> {
  const provider = deps.providers.get(id);
  if (provider) {
    await provider.login();
    return;
  }
  if (id === "gh") {
    deps.startCommand(commandSpec("gh", ["auth", "login"]), "GitHub login");
    return;
  }
  throw new IpcFailure("no-login", `${id} has no login to open`);
}

/** Opens the install command of a missing tool in a terminal tab, so the owner watches it run. */
export function installTool(deps: ToolActionDeps, id: string): void {
  const known = INSTALL_COMMANDS[id];
  if (!known) {
    throw new IpcFailure(
      "no-installer",
      "Office has no install command for this tool. Follow the Fix line next to it.",
    );
  }
  deps.startCommand(commandSpec(known.cmd, known.args), `Install ${known.label}`);
}
