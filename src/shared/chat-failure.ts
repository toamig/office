const terminalColor = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

export function chatFailure(raw: string, tool: string) {
  const message = raw.replace(terminalColor, "").trim();
  if (/oauth.*(?:expired|refresh|invalid)|refresh token.*(?:expired|used|invalid|missing)|invalid (?:api key|oauth token)|(?:authentication|authorization) (?:failed|required)|(?:not|never) (?:logged|signed) in|(?:run|use) \/login|not authenticated|\b401\b/i.test(message))
    return { kind: "login" as const, text: `${tool} is signed out. Log in again to continue.`, action: "Log in" };
  if (/usage limit|rate.limit|hit your limit|out of (?:extra )?usage|\b429\b/i.test(message)) {
    const reset = /\b(?:resets?(?:\s+at)?|try again (?:at|in))\s*:?\s*([^\r\n]{1,100})/i.exec(message)?.[1]?.trim();
    return { kind: "limit" as const, text: reset ? `Usage limit reached. Reset time: ${reset}` : "Usage limit reached.", action: "Retry" };
  }
  if (/model.{0,120}(?:not available|not supported|not found|does not exist|invalid|no access|do not have access)|(?:unknown|unsupported|invalid) model/i.test(message))
    return { kind: "model" as const, text: "This model is unavailable.", action: "Use the default model" };
  if (/network|econn(?:reset|refused)|enotfound|etimedout|timed out|connection (?:error|failed|closed|reset)|unable to connect|failed to fetch|stream disconnected|\b(?:502|503|504|529)\b/i.test(message))
    return { kind: "network" as const, text: `Could not connect to ${tool}.`, action: "Retry" };
  return { kind: "unknown" as const, text: "The turn failed", action: "Retry", details: message };
}
