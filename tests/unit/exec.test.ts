import { describe, expect, it } from "vitest";
import { resolveTool, run, spawnStream } from "../../src/main/core/exec";

describe("exec", () => {
  it("runs a command without a shell and captures output", async () => {
    const node = resolveTool("node");
    expect(node).toBeTruthy();
    const result = await run("node", [
      "-e",
      "process.stdout.write(process.argv[1] + ' & ok')",
      "a|b",
    ]);
    expect(result).toMatchObject({ code: 0, stdout: "a|b & ok" });
  });

  it("returns code -1 for a missing command instead of throwing", async () => {
    const result = await run("definitely-not-a-real-tool-xyz", []);
    expect(result.code).toBe(-1);
  });

  it("kills a command that exceeds its timeout", async () => {
    const result = await run("node", ["-e", "setTimeout(()=>{}, 20000)"], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });

  it("passes stdin and reports a non-zero exit code", async () => {
    const result = await run(
      "node",
      ["-e", "process.stdin.pipe(process.stdout); process.stdin.on('end',()=>process.exit(3))"],
      {
        input: "hello",
      },
    );
    expect(result).toMatchObject({ code: 3, stdout: "hello" });
  });

  it("streams stdout line by line", async () => {
    const stream = spawnStream("node", [
      "-e",
      "console.log('a'); console.log('b'); process.stdout.write('c')",
    ]);
    const lines: string[] = [];
    for await (const line of stream.lines) lines.push(line);
    expect(lines).toEqual(["a", "b", "c"]);
    expect((await stream.exit).code).toBe(0);
  });
});
