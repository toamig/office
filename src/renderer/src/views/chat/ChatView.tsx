import { GitBranch, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildChat, reduceChat, type ChatState as Conversation } from "@shared/chat";
import type { ChatLine, ChatState, SessionRow } from "@shared/models";
import { AutonomyPicker } from "../../components/AutonomyPicker";
import { PermissionRequests } from "../../components/PermissionRequests";
import { OfficeConfirmations } from "../../components/OfficeConfirmations";
import { Button, OverflowMenu, notifyError } from "../../ui";
import { isChatSession } from "@shared/roles";
import { useSessionActions } from "../../components/SessionActions";
import { office } from "../../lib/ipc";
import { Composer } from "./Composer";
import { ChatMessage } from "./Messages";
import { Dropdown as Select } from "../../ui";
import { StatusChip } from "../../components/StatusChip";

/** Said once, where the terminal is offered: what it is for. */
const TERMINAL_HINT = "For slash commands, logins and anything the chat does not show";

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
export function ChatView({
  session,
  onChanged,
  headerActions,
}: {
  session: SessionRow;
  onChanged: () => void;
  /** Buttons for the end of the header, from the view that owns the chat (Chat adds Close). */
  headerActions?: ReactNode;
}) {
  // A plain Chat has no wrap-up, terminal or autonomy picker.
  const plain = isChatSession(session);
  const { conversation, ready } = useConversation(session.id);
  const [state, setState] = useState<ChatState | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const revealConfirmation = useCallback(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

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
    try {
      await work();
    } catch (err) {
      notifyError(err, "Could not send that to the agent", session.id, {
        label: "Try again",
        run: () => void run(work),
      });
    }
  };

  const { wrapUp } = useSessionActions();
  const options = state?.options ?? {};
  // A narrow panel keeps the title and the status; model and Open in terminal go in a menu.
  const header = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = header.current;
    if (!el) return;
    const watch = new ResizeObserver(([e]) => setNarrow((e?.contentRect.width ?? 0) < 640));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const items = useMemo(() => conversation.items, [conversation.items]);

  return (
    <div className="chat" data-testid="chat" data-session={session.id}>
      <header className="chat-header" data-testid="chat-header" ref={header}>
        <span className="pane-title">{session.title ?? session.provider}</span>
        <StatusChip status={session.status} />
        {session.branch && (
          <span className="pane-branch">
            <GitBranch size={12} />
            {session.branch}
          </span>
        )}
        <div className="flex-1" />
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
        {!plain && session.autonomy && (
          <AutonomyPicker
            value={session.autonomy}
            disabled={conversation.working}
            onChange={(level) => office.invoke("sessions.setAutonomy", { id: session.id, level }).then(onChanged)}
          />
        )}
        {!plain && (
          <Button size="sm" onClick={() => wrapUp(session)} data-testid="wrap-up">
            Wrap up
          </Button>
        )}
        {narrow && !plain ? (
          <OverflowMenu
            label="Model and more"
            items={[
              ...(state?.kind === "claude"
                ? [
                    ...["", ...state.models].map((m) => ({
                      label: `Model: ${m === "" ? "Default model" : m}${(options.model ?? "") === m ? " (current)" : ""}`,
                      onSelect: () => {
                        setState({ ...state, options: { ...options, model: m || undefined } });
                        void run(() =>
                          office.invoke("chat.setOptions", {
                            id: session.id,
                            options: { model: m },
                          }),
                        );
                      },
                    })),
                  ]
                : []),
              {
                label: "Open in terminal",
                hint: TERMINAL_HINT,
                testId: "open-in-terminal",
                onSelect: () =>
                  void run(async () => {
                    await office.invoke("chat.toTerminal", { id: session.id });
                    onChanged();
                  }),
              },
            ]}
          />
        ) : (
          <>
            {state && state.kind === "claude" && (
              <>
                <Select
                  className="chat-select"
                  aria-label="Model"
                  data-testid="chat-model"
                  value={options.model ?? ""}
                  onChange={(e) => {
                    setState({
                      ...state,
                      options: { ...options, model: e.target.value || undefined },
                    });
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
                </Select>
              </>
            )}
            {!plain && (
              <OverflowMenu
                label="More about this session"
                testId="chat-more"
                items={[
                  {
                    label: "Open in terminal",
                    hint: TERMINAL_HINT,
                    testId: "open-in-terminal",
                    onSelect: () =>
                      void run(async () => {
                        await office.invoke("chat.toTerminal", { id: session.id });
                        onChanged();
                      }),
                  },
                ]}
              />
            )}
          </>
        )}
        {headerActions}
      </header>
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
              {plain
                ? "Ask a question or request an Office action."
                : "Ask the agent anything about this project."}
            </div>
          )}
          {items.map((item, i) => (
            <ChatMessage key={`${item.kind}-${"id" in item ? item.id : i}-${i}`} item={item} />
          ))}
          <PermissionRequests compact runId={session.id} />
          {!session.incognito && <OfficeConfirmations sessionId={session.id} onReveal={revealConfirmation} />}
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
