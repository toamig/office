import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unit tests must never read the owner's git config (hooks, signing, identity).
const dir = mkdtempSync(join(tmpdir(), "office-gitcfg-"));
const config = join(dir, "gitconfig");
writeFileSync(
  config,
  [
    "[user]",
    "\tname = Office Test",
    "\temail = test@example.invalid",
    "[init]",
    "\tdefaultBranch = main",
    "[core]",
    "\tautocrlf = false",
    "[commit]",
    "\tgpgsign = false",
    '[protocol "file"]',
    "\tallow = always",
    "",
  ].join("\n"),
);
process.env["GIT_CONFIG_GLOBAL"] = config;
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
process.env["GIT_TERMINAL_PROMPT"] = "0";
