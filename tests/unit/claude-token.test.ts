import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CLAUDE_TOKEN_ENV, claudeTerminalOutput } from "../../src/main/core/claude-secret";
import { spawnStream } from "../../src/main/core/exec";
import { ClaudeTokenStore } from "../../src/main/modules/providers/claude-auth";
import { ClaudeCodeProvider } from "../../src/main/modules/providers/claude-code";

it("passes the saved value in the Claude spawn environment and redacts it before output reaches logs", async () => {
  const marker = randomBytes(24).toString("hex");
  const store = new ClaudeTokenStore();
  vi.spyOn(store, "load").mockReturnValue(marker);
  const provider = new ClaudeCodeProvider({ tokens: store });
  const spec = provider.interactiveCommand({ officeSessionId: "example", cwd: process.cwd() });
  expect(spec.args.join(" ")).not.toContain(marker);
  const stream = spawnStream(process.execPath, ["-e", [
    `const value = process.env.${CLAUDE_TOKEN_ENV};`,
    "if (!value) process.exit(2);",
    "process.stdout.write(value.slice(0, 8));",
    "process.stdout.write(value.slice(8) + '\\n');",
    "process.stderr.write(value);",
  ].join(" ")], { prepare: spec.prepare });
  const output: string[] = [];
  for await (const line of stream.lines) output.push(line);
  expect(output).toEqual(["[redacted]"]);
  expect(await stream.exit).toEqual({ code: 0, stderr: "[redacted]" });
  const terminal = claudeTerminalOutput(marker);
  expect(terminal(marker.slice(0, 20)) + terminal(marker.slice(20))).toBe("[redacted]");
});
