import { Archive, Pencil, Pin, PinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionRow } from "@shared/models";
import { StatusChip } from "../components/StatusChip";
import { useQuery } from "../lib/hooks";
import { office } from "../lib/ipc";
import { useUi } from "../stores/ui";
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Page,
  SplitPane,
  Time,
  notifyError,
} from "../ui";
import { ChatView } from "./chat/ChatView";
import { SpawnWizard } from "./explore/SpawnWizard";

/** The words of the incognito header, so they are said the same everywhere. */
export const INCOGNITO_NOTE = "Incognito. Nothing is kept when you close it.";

/**
 * Chat: a plain conversation, with no code and no project. It can read your notes and the web and cannot run or change
 * anything. Chats are saved and named by their first message; an incognito chat keeps nothing once it is closed, and
 * is never listed. One action turns a chat into a project.
 */
export function Explore() {
  const linkedChat = useUi((state) => state.params["chat"]);
  const visit = useUi((state) => state.visits);
  const [applied, setApplied] = useState(-1);
  const sessions = useQuery("explore.list", undefined, ["session.status"]);
  const providers = useQuery("providers.list");
  const [active, setActive] = useState<string | null>(null);
  /** Incognito chats that are open: they are not in the list, so only this view knows them. */
  const [secret, setSecret] = useState<SessionRow[]>([]);
  const [incognito, setIncognito] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [renaming, setRenaming] = useState<SessionRow | null>(null);
  const [name, setName] = useState("");
  const [keeping, setKeeping] = useState(false);
  const [closing, setClosing] = useState<SessionRow | null>(null);
  if (applied !== visit) {
    setApplied(visit);
    if (linkedChat) setActive(linkedChat);
  }

  const saved = sessions.data ?? [];
  const all = [...secret, ...saved];
  const current = all.find((s) => s.id === active) ?? all[0];

  /** Claude Code when it is installed, else the first tool that can chat. */
  const providerId = (): string => {
    const ready = (providers.data ?? []).filter((p) => p.installed);
    return ready.find((p) => p.id === "claude-code")?.id ?? ready[0]?.id ?? "claude-code";
  };

  const start = async (secretly: boolean): Promise<void> => {
    try {
      const session = await office.invoke("explore.start", {
        providerId: providerId(),
        incognito: secretly,
      });
      if (secretly) setSecret((now) => [session, ...now]);
      else sessions.reload();
      setActive(session.id);
    } catch (err) {
      notifyError(err, "Could not start a chat", "chat", {
        label: "Try again",
        run: () => void start(secretly),
      });
    }
  };

  // Ctrl+Shift+N opens this view with an incognito chat already started.
  const asked = useUi((st) => st.params["incognito"]);
  const startedFromKey = useRef(false);
  useEffect(() => {
    if (asked !== "1" || startedFromKey.current || !providers.data) return;
    startedFromKey.current = true;
    void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, providers.data]);

  /** Fresh rows for the incognito chats, which the list does not return. */
  useEffect(() => {
    if (secret.length === 0) return;
    const refresh = (): void => {
      void Promise.all(
        secret.map((s) => office.invoke("sessions.get", { id: s.id }).catch(() => null)),
      ).then((rows) => setSecret((now) => now.map((s) => rows.find((r) => r?.id === s.id) ?? s)));
    };
    return office.on("session.status", refresh);
  }, [secret]);

  const close = async (s: SessionRow): Promise<void> => {
    try {
      await office.invoke("explore.close", { id: s.id });
      setSecret((now) => now.filter((x) => x.id !== s.id));
      if (active === s.id) setActive(null);
      sessions.reload();
    } catch (err) {
      notifyError(err, "Could not close that chat", "chat");
    } finally {
      setClosing(null);
    }
  };

  const keep = async (s: SessionRow): Promise<void> => {
    try {
      const kept = await office.invoke("explore.keep", { id: s.id });
      setSecret((now) => now.filter((x) => x.id !== s.id));
      sessions.reload();
      setActive(kept.id);
      setKeeping(false);
      setWizard(true);
    } catch (err) {
      notifyError(err, "Could not keep that chat", "chat");
    }
  };

  const rename = async (): Promise<void> => {
    if (!renaming || !name.trim()) return;
    try {
      await office.invoke("sessions.rename", { id: renaming.id, title: name.trim() });
      setRenaming(null);
      sessions.reload();
    } catch (err) {
      notifyError(err, "Could not rename that chat", "chat");
    }
  };

  const listPane = (
    <div data-testid="explore-list">
      {all.length === 0 && (
        <EmptyState
          title="No chats yet"
          action={
            <Button variant="primary" onClick={() => void start(incognito)}>
              New chat
            </Button>
          }
        >
          Think an idea through, or ask about your notes.
        </EmptyState>
      )}
      {all.map((s) => (
        <div
          key={s.id}
          data-testid="explore-row"
          data-incognito={s.incognito ? "true" : undefined}
          className="ui-row"
          role="button"
          tabIndex={0}
          data-clickable="true"
          data-selected={current?.id === s.id ? "true" : undefined}
          onClick={() => setActive(s.id)}
          onKeyDown={(e) => e.key === "Enter" && setActive(s.id)}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium" data-testid="chat-name">
              {s.title}
            </div>
            <div className="ui-badges ui-line-sub">
              {s.incognito ? <span>Not saved</span> : <Time iso={s.updatedAt} />}
              <StatusChip status={s.status} />
            </div>
          </div>
          {!s.incognito && (
            <div className="session-actions flex gap-0.5">
              <IconButton
                size="sm"
                label={s.pinned ? "Unpin" : "Pin"}
                onClick={(e) => {
                  e.stopPropagation();
                  void office
                    .invoke("sessions.pin", { id: s.id, pinned: !s.pinned })
                    .then(sessions.reload);
                }}
                data-testid="chat-pin"
              >
                {s.pinned ? <PinOff /> : <Pin />}
              </IconButton>
              <IconButton
                size="sm"
                label="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setName(s.title ?? "");
                  setRenaming(s);
                }}
                data-testid="chat-rename"
              >
                <Pencil />
              </IconButton>
              <IconButton
                size="sm"
                label="Archive"
                onClick={(e) => {
                  e.stopPropagation();
                  void close(s);
                }}
                data-testid="chat-archive"
              >
                <Archive />
              </IconButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Page
      title="Chat"
      subtitle="A conversation for ideas and questions. It can read your notes and the web, and changes nothing."
      testId="explore"
      fill
      primary={
        <span className="flex items-center gap-3">
          <label
            className="flex items-center gap-1"
            title="Nothing is kept when you close it (Ctrl+Shift+N)"
          >
            <input
              type="checkbox"
              checked={incognito}
              onChange={(e) => setIncognito(e.target.checked)}
              data-testid="chat-incognito"
            />{" "}
            Incognito
          </label>
          <Button
            variant="primary"
            onClick={() => void start(incognito)}
            data-testid="explore-start"
          >
            New chat
          </Button>
        </span>
      }
      more={[
        {
          label: "Turn into a project...",
          onSelect: () => {
            if (!current) return;
            if (current.incognito) setKeeping(true);
            else setWizard(true);
          },
          testId: "make-project",
        },
      ]}
    >
      <SplitPane
        id="explore"
        defaultSize={300}
        min={220}
        minSecond={420}
        first={listPane}
        second={
          <div className="ui-panel-bg flex h-full flex-col">
            {current?.incognito && (
              <Banner tone="attention" testId="incognito-note">
                <span className="flex flex-wrap items-center gap-3">
                  <span>{INCOGNITO_NOTE}</span>
                  <Button
                    size="sm"
                    onClick={() => setClosing(current)}
                    data-testid="incognito-close"
                  >
                    Close and erase
                  </Button>
                </span>
              </Banner>
            )}
            <div className="min-h-0 flex-1">
              {current ? (
                <ChatView
                  key={current.id}
                  session={current}
                  onChanged={() => sessions.reload()}
                  headerActions={
                    current.incognito ? null : (
                      <Button
                        size="sm"
                        onClick={() => void close(current)}
                        data-testid="chat-close"
                      >
                        Close
                      </Button>
                    )
                  }
                />
              ) : null}
            </div>
          </div>
        }
      />
      {wizard && current && (
        <SpawnWizard exploreSessionId={current.id} onClose={() => setWizard(false)} />
      )}
      {renaming && (
        <Dialog
          title="Rename this chat"
          testId="chat-rename-dialog"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button onClick={() => setRenaming(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name.trim()}
                onClick={() => void rename()}
                data-testid="chat-rename-save"
              >
                Save
              </Button>
            </>
          }
        >
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="chat-rename-name"
          />
        </Dialog>
      )}
      {keeping && current && (
        <Dialog
          title="Turn incognito off for this chat?"
          testId="incognito-keep-dialog"
          onClose={() => setKeeping(false)}
          footer={
            <>
              <Button onClick={() => setKeeping(false)}>Stay incognito</Button>
              <Button
                variant="primary"
                onClick={() => void keep(current)}
                data-testid="incognito-keep"
              >
                Turn incognito off
              </Button>
            </>
          }
        >
          <p className="m-0">
            A chat that is incognito cannot become a project. Turning it off saves this chat, with
            everything said so far, so its conclusions can go into the new project&apos;s notes.
          </p>
        </Dialog>
      )}
      {closing && (
        <Dialog
          title="Close and erase this chat?"
          testId="incognito-close-dialog"
          onClose={() => setClosing(null)}
          footer={
            <>
              <Button onClick={() => setClosing(null)}>Keep it open</Button>
              <Button
                variant="danger"
                onClick={() => void close(closing)}
                data-testid="incognito-close-confirm"
              >
                Close and erase
              </Button>
            </>
          }
        >
          <p className="m-0">Nothing of it is kept, and it cannot be brought back.</p>
        </Dialog>
      )}
    </Page>
  );
}
