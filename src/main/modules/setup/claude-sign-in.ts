import { stripVTControlCharacters } from "node:util";
import * as pty from "node-pty";
import { CLAUDE_TOKEN_ENV } from "../../core/claude-secret";
import { dataDir } from "../../core/paths";
import type { ClaudeTokenStore } from "../providers/claude-auth";
import type { ClaudeCodeProvider } from "../providers/claude-code";

type Phase = "idle" | "waiting" | "saved" | "failed";

/** Owns the private setup-token terminal. Its output never enters the session or IPC event streams. */
export class ClaudeSignIn {
  private child?: pty.IPty;
  private timer?: NodeJS.Timeout;
  private phase: Phase = "idle";
  private url?: string;

  constructor(
    private readonly store: ClaudeTokenStore,
    private readonly provider: ClaudeCodeProvider,
    private readonly changed: () => void,
  ) {}

  status() {
    return { available: this.store.available, saved: this.store.saved, phase: this.phase, url: this.url };
  }

  start(): void {
    if (!this.store.available) throw new Error("Secure storage is unavailable.");
    this.cancel();
    const spec = this.provider.setupTokenCommand();
    const child = pty.spawn(spec.cmd, spec.args, {
      name: "xterm-256color", cols: 512, rows: 30, cwd: dataDir(),
      env: { ...process.env, [CLAUDE_TOKEN_ENV]: "" } as Record<string, string>,
    });
    this.child = child;
    this.phase = "waiting";
    let output = "";
    const inspect = (end = false): boolean => {
      const plain = stripVTControlCharacters(output);
      const token = /\b(sk-ant-oat\d+-[a-zA-Z0-9_-]{32,})(?=[^a-zA-Z0-9_-]|$)/.exec(plain);
      if (token?.[1] && (end || (token.index + token[0].length < plain.length))) {
        output = "";
        try {
          this.store.save(token[1]);
          this.provider.auth.reset();
          this.finish("saved");
        } catch {
          this.finish("failed");
        }
        return true;
      }
      this.url ??= browserUrl(plain);
      return false;
    };
    child.onData((chunk) => {
      if (this.child !== child) return;
      output = (output + chunk).slice(-24_000);
      inspect();
    });
    child.onExit(() => {
      if (this.child === child && !inspect(true)) this.finish("failed", false);
      output = "";
    });
    this.timer = setTimeout(() => { output = ""; this.finish("failed"); }, 10 * 60_000);
  }

  submit(code: string): void {
    if (!this.child || !this.url || !/^[A-Za-z0-9._~%/#=:+-]{4,2048}$/.test(code) || /^sk-ant-/i.test(code))
      throw new Error("Paste the authorization code from the browser.");
    this.child.write(`${code}\r`);
  }

  cancel(): void {
    this.finish("idle");
  }

  remove(): void {
    this.cancel();
    this.store.remove();
    this.provider.auth.reset();
    this.changed();
  }

  private finish(phase: Phase, kill = true): void {
    const child = this.child;
    this.child = undefined;
    this.phase = phase;
    this.url = undefined;
    clearTimeout(this.timer);
    if (kill && child) {
      try { child.kill(); } catch { /* It may have already exited. */ }
    }
    if (phase === "saved") this.changed();
  }
}

function browserUrl(text: string): string | undefined {
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+(?=[\s<>"'])/g)) {
    try {
      const url = new URL(match[0]);
      if (["claude.ai", "platform.claude.com", "console.anthropic.com"].includes(url.hostname)
          && !url.username && !url.password && !/sk-ant-/i.test(url.href)
          && /(?:oauth|authorize)/i.test(url.pathname))
        return url.href;
    } catch { /* Ignore an incomplete or malformed address. */ }
  }
  return undefined;
}
