export const OFFICE_COMMANDS = ["model", "effort", "clear", "rewind", "resume"] as const;
export type OfficeCommand = typeof OFFICE_COMMANDS[number];

export type SlashCommand = { name: OfficeCommand; kind: "office" } | { name: string; kind: "message" | "terminal" };

const TERMINAL_COMMANDS = new Set([
  "agents", "doctor", "help", "login", "logout", "mcp", "memory", "output-style",
  "permissions", "plugin", "status", "theme", "vim",
]);

export function slashMenu(names: string[], claude: boolean, terminal: boolean): SlashCommand[] {
  const commands: SlashCommand[] = OFFICE_COMMANDS.map((name) => ({ name, kind: "office" }));
  if (!claude) return commands;
  const known = new Set<string>(OFFICE_COMMANDS);
  for (const name of [...new Set([...names, ...(terminal ? TERMINAL_COMMANDS : [])])].sort()) {
    if (known.has(name)) continue;
    if (TERMINAL_COMMANDS.has(name)) {
      if (terminal) commands.push({ name, kind: "terminal" });
    } else commands.push({ name, kind: "message" });
  }
  return commands;
}
