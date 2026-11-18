import { GitBranch, Square, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildChat, reduceChat, type ChatState as Conversation } from "@shared/chat";
import type { ChatLine, ChatState, SessionRow } from "@shared/models";
import { PermissionRequests } from "../../components/PermissionRequests";
import { Chip, ErrorBanner } from "../../components/ui";
import { office } from "../../lib/ipc";
import { Composer } from "./Composer";
import { ChatMessage } from "./Messages";

const tone = (s: SessionRow["status"]): "neutral" | "good" | "warn" | "bad" =>
  s === "needs-you" || s === "failed" ? "bad" : s === "working" ? "good" : "neutral";

/** The conversation of one chat session, built from its stored events and then from the live ones. */
function useConversation(id: string): { conversation: Conversation; ready: boolean } {
  const [conversation, setConversation] = useState<Conversation>({ items: [], working: false });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    let last = 0;
    const waiting: ChatLine[] = [];
    const loaded = { current: false };
    const apply = (line: ChatLine): void => {
      if (line.seq <= last) return;
      last = line.seq;
      setConversation((c) => reduceChat(c, line.event));
    };
    const off = office.on("chat.event", (e) => {
      const payload = e.payload as { sessionId: string; line: ChatLine };
      if (payload.sessionId !== id) return;
      if (!loaded.current) waiting.push(payload.line);
      else apply(payload.line);
    });
    void office.invoke("chat.history", { id }).then((lines) => {
      if (!alive) return;
      setConversation(buildChat(lines.map((l) => l.event)));
      last = lines.at(-1)?.seq ?? 0;
      loaded.current = true;
      for (const line of waiting.splice(0)) apply(line);
      setReady(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, [id]);
  return { conversation, ready };
}

/**
 * An agent conversation as a chat (spec 4.3): bubbles, streaming answers, tool cards, inline approvals and a
 * composer. The program underneath is still the real CLI; Open in terminal moves the same conversation into
 * an embedded terminal.
 */
export function ChatView({ session, onChanged }: { session: SessionRow; onChanged: () => void }) {
  const { conversation, ready } = useConversation(session.id);
  const [state, setState] = useState<ChatState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void office.invoke("chat.state", { id: session.id }).then((s) => alive && setState(s));
    };
    load();
    const off = office.on("chat.state", (e) => {
      if ((e.payload as { sessionId?: string }).sessionId === session.id) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [session.id, conversation.working]);

  // Stay at the bottom while the answer streams, unless the owner scrolled up to read.
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [conversation]);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const options = state?.options ?? {};
  const items = useMemo(() => conversation.items, [conversation.items]);

  return (
    <div className="chat" data-testid="chat" data-session={session.id}>
      <header className="chat-header" data-testid="chat-header">
        <span className="pane-title">{session.title ?? session.provider}</span>
        <Chip tone={tone(session.status)}>{session.status}</Chip>
        {session.branch && (
          <span className="pane-branch">
            <GitBranch size={12} />
            {session.branch}
          </span>
        )}
        <div className="flex-1" />
        {state && state.kind === "claude" && (
          <>
            <select
              className="chat-select"
              aria-label="Model"
              data-testid="chat-model"
              value={options.model ?? ""}
              onChange={(e) => {
                setState({ ...state, options: { ...options, model: e.target.value || undefined } });
                void run(() =>
                  office.invoke("chat.setOptions", {
                    id: session.id,
                    options: { model: e.target.value },
                  }),
                );
              }}
              title="Applies from the next message"
            >
              <option value="">Default model</option>
              {state.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="chat-select"
              aria-label="Permission mode"
              data-testid="chat-permission-mode"
              value={options.permissionMode ?? "default"}
              onChange={(e) => {
                setState({ ...state, options: { ...options, permissionMode: e.target.value } });
                void run(() =>
                  office.invoke("chat.setOptions", {
                    id: session.id,
                    options: { permissionMode: e.target.value },
                  }),
                );
              }}
            >
              {state.permissionModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </>
        )}
        {state && state.kind === "codex" && (
          <Chip tone="warn">
            <span data-testid="chat-sandbox">sandbox: {state.sandbox}</span>
          </Chip>
        )}
        {conversation.working && (
          <button
            className="chat-link"
            aria-label="Stop"
            title="Stop this turn"
            onClick={() => void run(() => office.invoke("chat.stop", { id: session.id }))}
            data-testid="chat-header-stop"
          >
            <Square size={12} /> Stop
          </button>
        )}
        <button
          className="chat-link"
          onClick={() =>
            void run(async () => {
              await office.invoke("chat.toTerminal", { id: session.id });
              onChanged();
            })
          }
          data-testid="open-in-terminal"
        >
          <SquareTerminal size={13} /> Open in terminal
        </button>
      </header>
      {error && <ErrorBanner message={error} />}
      <div
        className="chat-scroll"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        data-testid="chat-scroll"
      >
        <div className="chat-column">
          {ready && items.length === 0 && (
            <div className="chat-empty" data-testid="chat-empty">
              Ask the agent anything about this project.
            </div>
          )}
          {items.map((item, i) => (
            <ChatMessage key={`${item.kind}-${"id" in item ? item.id : i}-${i}`} item={item} />
          ))}
          <PermissionRequests compact runId={session.id} />
          {conversation.working &&
            !items.some((i) => i.kind === "assistant" && i.streaming && i.text !== "") && (
              <div className="working-dots" data-testid="chat-working" aria-label="Working">
                <span />
                <span />
                <span />
              </div>
            )}
        </div>
      </div>
      <div className="chat-column pb-4">
        <Composer
          sessionId={session.id}
          working={conversation.working}
          onSend={(text, images) =>
            void run(() => office.invoke("chat.send", { id: session.id, text, images }))
          }
          onStop={() => void run(() => office.invoke("chat.stop", { id: session.id }))}
        />
      </div>
    </div>
  );
}
