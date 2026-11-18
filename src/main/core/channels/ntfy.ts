import type { NotificationRow } from "../../../shared/models";
import type { Channel } from "../notifier";

const TIMEOUT_MS = 8000;

/**
 * Phone pings through ntfy (plan 11, M5.2): an HTTP POST of the notification to a topic URL the owner
 * sets. The title goes in the query string (headers must be ASCII); the click link is left out on purpose.
 */
export class NtfyChannel implements Channel {
  readonly id = "ntfy";

  constructor(private readonly topicUrl: () => string | undefined) {}

  /** Sends one message; a failure is reported to the caller, which logs it. */
  async post(title: string, body: string): Promise<void> {
    const base = this.topicUrl();
    if (!base) return;
    const url = new URL(base);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("The ntfy topic must be an http or https URL");
    url.searchParams.set("title", title);
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
  }

  send(notification: NotificationRow): Promise<void> {
    return this.post(notification.title, notification.body ?? notification.title);
  }
}
