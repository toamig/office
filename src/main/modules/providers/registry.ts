import { resolveTool } from "../../core/exec";
import { ClaudeCodeProvider } from "./claude-code";
import { CodexProvider } from "./codex";
import type { Provider, TerminalOpener } from "./types";

/** Knows every provider by id. A "fake" provider appears when OFFICE_BIN_FAKE_CLAUDE is set (tests, dev). */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();
  private opener: TerminalOpener | null = null;

  constructor() {
    const openTerminal = (): TerminalOpener | null => this.opener;
    this.add(new ClaudeCodeProvider({ openTerminal }));
    this.add(new CodexProvider({ openTerminal }));
    if (resolveTool("fake-claude")) {
      this.add(
        new ClaudeCodeProvider({
          id: "fake",
          label: "Fake agent",
          bin: "fake-claude",
          openTerminal,
        }),
      );
    }
  }

  add(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  all(): Provider[] {
    return [...this.providers.values()];
  }

  /** The sessions module gives providers a way to open a terminal tab for logins. */
  setTerminalOpener(opener: TerminalOpener): void {
    this.opener = opener;
  }
}
