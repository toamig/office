import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatFailure } from "../../../shared/chat-failure";
import { CLAUDE_TOKEN_ENV } from "../../core/claude-secret";
import { run } from "../../core/exec";
import { dataDir } from "../../core/paths";
import type { CommandSpec } from "./types";
import { claudeModelCatalog } from "./chat-models";
import type { ChatModel } from "../../../shared/models";

export interface SecretStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class ClaudeTokenStore {
  constructor(private readonly storage?: SecretStorage) {}

  get available(): boolean {
    return this.storage?.isEncryptionAvailable() === true && this.storage.getSelectedStorageBackend?.() !== "basic_text";
  }

  private file(): string {
    return join(dataDir(), "claude-oauth.enc");
  }

  get saved(): boolean {
    return existsSync(this.file());
  }

  load(): string | undefined {
    if (!this.available || !this.saved) return undefined;
    try {
      return this.storage?.decryptString(readFileSync(this.file()));
    } catch {
      throw new Error("Office could not unlock the saved Claude sign-in. Remove it and sign in again.");
    }
  }

  save(token: string): void {
    if (!this.available || !this.storage) throw new Error("Secure storage is unavailable.");
    const file = this.file();
    const temporary = `${file}.new`;
    try {
      writeFileSync(temporary, this.storage.encryptString(token), { mode: 0o600 });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  remove(): void {
    rmSync(this.file(), { force: true });
    rmSync(`${this.file()}.new`, { force: true });
  }
}

const signedOut = "Claude Code is not authenticated.";

/** One authenticated request opens the gate for Claude work after startup or a sign-in failure. */
export class ClaudeAuth {
  private probe?: Promise<void>;
  private authenticated = false;
  private retryAfter = 0;
  private rejectedToken = false;
  revision = 0;
  defaultModel?: string;
  models: ChatModel[] = [];

  constructor(private readonly cli: (args: string[]) => CommandSpec, private readonly store?: ClaudeTokenStore) {}

  env(): Record<string, string> {
    const token = this.store?.load();
    return token ? { [CLAUDE_TOKEN_ENV]: token } : {};
  }

  reset(): void {
    this.revision++;
    this.probe = undefined;
    this.authenticated = false;
    this.retryAfter = 0;
    this.rejectedToken = false;
    this.defaultModel = undefined;
    this.models = [];
  }

  loginStarting(): void {
    if (this.rejectedToken) this.store?.remove();
    this.reset();
    this.retryAfter = Date.now() + 30_000;
  }

  failed(message: string): void {
    if (chatFailure(message, "Claude Code").kind !== "login") return;
    this.authenticated = false;
    this.revision++;
    this.retryAfter = Date.now() + 30_000;
    this.rejectedToken = this.store?.saved === true;
  }

  async prepare(): Promise<Record<string, string>> {
    const env = this.env();
    if (env[CLAUDE_TOKEN_ENV] || process.env[CLAUDE_TOKEN_ENV] || this.authenticated) return env;
    if (Date.now() < this.retryAfter) throw new Error(signedOut);
    await this.check();
    return this.env();
  }

  async model(): Promise<string | undefined> {
    if (this.defaultModel) return this.defaultModel;
    if (Date.now() < this.retryAfter) return undefined;
    await this.check().catch(() => undefined);
    return this.defaultModel;
  }

  private check(): Promise<void> {
    if (this.probe) return this.probe;
    const pending = this.probe = this.runProbe(this.revision);
    void pending.finally(() => {
      if (this.probe === pending) this.probe = undefined;
    }).catch(() => undefined);
    return pending;
  }

  private async runProbe(revision: number): Promise<void> {
    const args = ["-p", "--input-format", "stream-json", "--max-turns", "1", "--tools", "", "--strict-mcp-config",
      "--permission-mode", "dontAsk", "--no-session-persistence", "--output-format", "stream-json", "--verbose",
      "--settings", '{"disableAllHooks":true}'];
    const cli = this.cli(args);
    const input = [
      { type: "control_request", request_id: "office-models", request: { subtype: "initialize" } },
      { type: "user", message: { role: "user", content: "Reply with OK." }, parent_tool_use_id: null, session_id: "" },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n";
    const result = await run(cli.cmd, cli.args, { cwd: dataDir(), env: this.env(), input, timeoutMs: 20_000 });
    let failure = result.stderr.trim();
    let model: string | undefined;
    let success = false;
    let models: ChatModel[] = [];
    for (const line of result.stdout.split("\n")) {
      try {
        const event = JSON.parse(line);
        if (event.type === "system" && event.subtype === "init" && typeof event.model === "string")
          model = event.model;
        if (event.type === "control_response" && event.response?.request_id === "office-models")
          models = claudeModelCatalog(event.response.response?.models);
        if (event.type === "assistant" && event.error && Array.isArray(event.message?.content)) {
          failure = event.message.content.map((block: { text?: string }) => block.text ?? "").filter(Boolean).join("\n") || failure;
        }
        if (event.type === "error" && typeof event.message === "string") failure = event.message;
        if (event.type === "result") {
          success = event.is_error !== true;
          if (!success && typeof event.result === "string") failure = event.result;
          else if (!success && Array.isArray(event.errors)) failure = event.errors.join("\n") || failure;
        }
      } catch { /* Skip progress text outside the JSON stream. */ }
    }
    if (revision !== this.revision) throw new Error("Claude sign-in changed. Retry this turn.");
    this.defaultModel = model;
    this.models = models;
    if (result.code === 0 && success) {
      this.authenticated = true;
      return;
    }
    this.failed(failure);
    throw new Error(failure || "Could not connect to Claude Code.");
  }
}
