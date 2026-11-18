import type { ToolStatus } from "../../../shared/models";

/**
 * The last look at the command-line tools. Looking runs the tools themselves (a few hundred milliseconds
 * each), so it never happens because a screen asked: it runs at start, every 15 minutes and when the owner
 * presses Check again, and everyone else reads the last answer.
 */
export class ToolsMonitor {
  private last: ToolStatus[] | null = null;
  private inflight: Promise<ToolStatus[]> | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly detect: () => Promise<ToolStatus[]>,
    private readonly onChange: (tools: ToolStatus[]) => void,
  ) {}

  /** The last result, or null before the first look has finished. */
  get current(): ToolStatus[] | null {
    return this.last;
  }

  /** Looks now. A look already under way is reused, so the tools never run twice at once. */
  check(): Promise<ToolStatus[]> {
    this.inflight ??= this.detect()
      .then((tools) => {
        this.last = tools;
        this.onChange(tools);
        return tools;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** The last result when there is one, otherwise waits for the first look. */
  async read(): Promise<ToolStatus[]> {
    return this.last ?? this.check();
  }

  start(everyMs = 900_000): void {
    this.stop();
    void this.check().catch(() => undefined);
    this.timer = setInterval(() => void this.check().catch(() => undefined), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
