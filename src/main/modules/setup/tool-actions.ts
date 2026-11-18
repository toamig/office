import { resolveCommand, resolveTool } from "../../core/exec";
import { IpcFailure } from "../../core/ipc";
import type { SessionRow } from "../../../shared/models";
import type { ProviderRegistry } from "../providers/registry";
import type { CommandSpec } from "../providers/types";

export interface ToolActionDeps {
  providers: Pick<ProviderRegistry, "get">;
  /** Opens a command in a terminal tab, where the owner sees it run and answers its prompts. */
  startCommand: (spec: CommandSpec, title: string) => SessionRow | void;
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

/** The command that logs a tool in: the provider's own for an agent tool, `gh auth login` for GitHub. */
function loginSpec(deps: ToolActionDeps, id: string): { spec: CommandSpec; title: string } {
  const provider = deps.providers.get(id);
  if (provider) return { spec: provider.loginCommand(), title: `${provider.label} login` };
  if (id === "gh") return { spec: commandSpec("gh", ["auth", "login"]), title: "GitHub login" };
  throw new IpcFailure("no-login", `${id} has no login to open`);
}

/** Like loginTool, and answers with the session, so the welcome flow can show the terminal in its own step. */
export function loginSession(deps: ToolActionDeps, id: string): SessionRow {
  const { spec, title } = loginSpec(deps, id);
  return opened(deps.startCommand(spec, title));
}

/** Like installTool, and answers with the session. */
export function installSession(deps: ToolActionDeps, id: string): SessionRow {
  const known = INSTALL_COMMANDS[id];
  if (!known) {
    throw new IpcFailure(
      "no-installer",
      "Office has no install command for this tool. Follow the Fix line next to it.",
    );
  }
  return opened(deps.startCommand(commandSpec(known.cmd, known.args), `Install ${known.label}`));
}

const opened = (row: SessionRow | void): SessionRow => {
  if (!row) throw new IpcFailure("no-terminal", "No terminal is available to run this");
  return row;
};
