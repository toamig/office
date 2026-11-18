import type { EventType, OfficeEvent } from "../../shared/ipc";

type Handler = (event: OfficeEvent) => void;

/** A small typed event bus. Main forwards every event to the renderer as `office:event`. */
export class Bus {
  private readonly handlers = new Map<EventType | "*", Set<Handler>>();

  on(type: EventType | "*", handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    const owned = set;
    owned.add(handler);
    return () => owned.delete(handler);
  }

  emit(type: EventType, payload: unknown, projectId?: string): OfficeEvent {
    const event: OfficeEvent = {
      type,
      at: new Date().toISOString(),
      payload,
      ...(projectId ? { projectId } : {}),
    };
    for (const handler of [...(this.handlers.get(type) ?? []), ...(this.handlers.get("*") ?? [])]) {
      try {
        handler(event);
      } catch (err) {
        console.error(`bus handler for ${type} failed:`, err);
      }
    }
    return event;
  }
}
