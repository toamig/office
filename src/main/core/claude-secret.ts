export const CLAUDE_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

export function redactClaudeToken(text: string, token?: string): string {
  return (token ? text.replaceAll(token, "[redacted]") : text)
    .replace(/sk-ant-oat\d+-[A-Za-z0-9_-]+/g, "[redacted]");
}

/** A terminal can split the environment value at any output boundary. Hold only a possible prefix. */
export function claudeTerminalOutput(token?: string) {
  let pending = "";
  return (chunk: string, end = false): string => {
    let text = pending + chunk;
    pending = "";
    if (token) {
      text = text.replaceAll(token, "[redacted]");
      if (!end) {
        for (let n = Math.min(text.length, token.length - 1); n > 0; n--) {
          if (!text.endsWith(token.slice(0, n))) continue;
          pending = text.slice(-n);
          text = text.slice(0, -n);
          break;
        }
      }
    }
    return redactClaudeToken(text);
  };
}
