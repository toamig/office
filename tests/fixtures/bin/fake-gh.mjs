// A fake `gh` CLI for tests. Repos it "creates" are bare repos under FAKE_GH_REMOTES, and every call
// is logged to FAKE_GH_REMOTES/gh.log so tests can check the flags (visibility, source, push).
// PR and CI listings come from the JSON files FAKE_GH_PRS and FAKE_GH_RUNS when they are set.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const remotes = process.env["FAKE_GH_REMOTES"] ?? join(process.cwd(), "fake-gh-remotes");
mkdirSync(remotes, { recursive: true });
appendFileSync(join(remotes, "gh.log"), `${JSON.stringify(args)}\n`);

const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args[0] === "--version") {
  console.log("gh version 9.9.9 (fake)");
} else if (args[0] === "auth" && args[1] === "status") {
  console.log("Logged in to github.com account fixture-owner (fake)");
} else if (args[0] === "api" && args[1] === "user") {
  console.log("fixture-owner");
} else if (args[0] === "repo" && args[1] === "create") {
  const full = args[2] ?? "";
  const name = full.split("/").pop();
  if (!name || process.env["FAKE_GH_FAIL_CREATE"] === name) {
    console.error(`GraphQL: Name already exists on this account (createRepository)`);
    process.exit(1);
  }
  const bare = join(remotes, `${name}.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { stdio: "ignore" });
  const source = flag("--source");
  if (source) {
    execFileSync("git", ["-C", source, "remote", "add", "origin", bare], { stdio: "ignore" });
    if (args.includes("--push")) {
      execFileSync("git", ["-C", source, "push", "-q", "-u", "origin", "HEAD"], { stdio: "ignore" });
    }
  }
  console.log(`https://github.com/${full}`);
} else if (args[0] === "repo" && args[1] === "view" && args.includes("visibility")) {
  // FAKE_GH_VISIBILITY is "folder=PUBLIC,other=PRIVATE" keyed by the folder gh runs in; "*" is the default
  // (PRIVATE when unset) and the value "fail" makes the call fail, as when gh is not logged in.
  const table = Object.fromEntries(
    (process.env["FAKE_GH_VISIBILITY"] ?? "")
      .split(",")
      .filter(Boolean)
      .map((pair) => pair.split("=")),
  );
  const value = table[process.cwd().split(/[\\/]/).pop() ?? ""] ?? table["*"] ?? "PRIVATE";
  if (value === "fail") {
    console.error("fake-gh: could not resolve to a Repository");
    process.exit(1);
  }
  console.log(JSON.stringify({ visibility: value }));
} else if (args[0] === "pr" && args[1] === "list") {
  const file = process.env["FAKE_GH_PRS"];
  console.log(file && existsSync(file) ? readFileSync(file, "utf8") : "[]");
} else if (args[0] === "run" && args[1] === "list") {
  const file = process.env["FAKE_GH_RUNS"];
  console.log(file && existsSync(file) ? readFileSync(file, "utf8") : "[]");
} else {
  console.error(`fake-gh: unhandled arguments ${JSON.stringify(args)}`);
  process.exit(1);
}
