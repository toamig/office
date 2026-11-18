// A fake `claude` CLI for tests. Behaviour is selected by arguments and FAKE_* environment variables.
// Extended in M2 with interactive and headless modes.
const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("2.1.999 (Claude Code)");
} else if (args[0] === "auth" && args[1] === "status") {
  const loggedIn = process.env["FAKE_LOGGED_IN"] !== "0";
  console.log(JSON.stringify({ loggedIn, authMethod: "fake" }, null, 2));
  process.exit(loggedIn ? 0 : 1);
} else if (args[0] === "mcp" && args[1] === "list") {
  console.log("Checking MCP server health...\n");
  console.log("notion: npx -y @notionhq/notion-mcp-server - ✔ Connected");
  console.log("other: https://example.invalid/mcp (HTTP) - ! Needs authentication");
} else {
  console.log("fake-claude: unhandled arguments " + JSON.stringify(args));
}
