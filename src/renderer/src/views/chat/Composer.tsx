import { ArrowUp, Square } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ChatImage } from "@shared/models";
import { office } from "../../lib/ipc";
import { OverflowMenu, notifyError } from "../../ui";
import type { SlashCommand } from "./commands";

const PRESETS = [
  {
    label: "Research",
    prompt: "Research this with several read-only subagents. Give each a distinct angle, check their sources, then combine the findings and cite the evidence. Topic\n",
  },
  {
    label: "Debate",
    prompt: "Have two subagents argue opposing sides, then a third judge weigh the evidence and give a verdict. Question\n",
  },
];

/** The text typed after the last @ before the caret, when that @ starts a word. */
function mentionAt(value: string, caret: number): { from: number; query: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const query = before.slice(at + 1);
  return /\s/.test(query) ? null : { from: at, query };
}

const readImage = (file: File): Promise<ChatImage> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ mediaType: file.type || "image/png", data: url.slice(url.indexOf(",") + 1) });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * The message box: Enter sends and Shift+Enter starts a new line, @ mentions a project file, a pasted image
 * is attached, and messages composed during a turn can be queued.
 */
export function Composer({
  sessionId,
  working,
  onSend,
  onStop,
  controls,
  commands,
  onSlashOpen,
  onCommand,
}: {
  sessionId: string;
  working: boolean;
  onSend: (text: string, images: ChatImage[]) => Promise<boolean>;
  onStop: () => void;
  controls?: ReactNode;
  commands: SlashCommand[];
  onSlashOpen: () => void;
  onCommand: (command: SlashCommand) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [mention, setMention] = useState<{ from: number; query: string } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [pick, setPick] = useState(0);
  const [sending, setSending] = useState(false);
  const [slash, setSlash] = useState<string>();
  const [commandPick, setCommandPick] = useState(0);
  const commandListId = useId();
  const commandList = useRef<HTMLUListElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const matches = slash === undefined ? [] : commands.filter((command) => command.name.startsWith(slash));
  const selected = Math.min(commandPick, matches.length - 1);

  useEffect(() => {
    commandList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!mention) return;
    let alive = true;
    void office.invoke("chat.files", { id: sessionId, query: mention.query }).then((list) => {
      if (!alive) return;
      setFiles(list);
      setPick(0);
    });
    return () => {
      alive = false;
    };
  }, [mention, sessionId]);

  const choose = (file: string): void => {
    if (!mention) return;
    const caret = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.from)}@${file} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    setFiles([]);
    requestAnimationFrame(() => {
      const el = area.current;
      // Put the caret after the mention, unless the owner has already typed on: then it is where they left it.
      if (!el || el.value !== next) return;
      const end = mention.from + file.length + 2;
      el.setSelectionRange(end, end);
      el.focus();
    });
  };

  const submit = (action: () => Promise<boolean>, clearImages = false): void => {
    if (sending) return;
    setSending(true);
    void action().then((sent) => {
      if (!sent) return;
      setText((current) => current === text ? "" : current);
      if (clearImages) setImages((current) => current.filter((image) => !images.includes(image)));
      setMention(null);
      setSlash(undefined);
    }).finally(() => setSending(false));
  };

  const chooseCommand = (command: SlashCommand): void => {
    if (command.kind === "message") submit(() => onSend(`/${command.name}`, images), true);
    else submit(() => onCommand(command));
  };

  const send = (): void => {
    const body = text.trim();
    if (!body) return;
    const exact = commands.find((command) => `/${command.name}` === body);
    if (exact && exact.kind !== "message") chooseCommand(exact);
    else submit(() => onSend(body, images), true);
  };

  const attach = (files: File[]) => {
    void Promise.all(files.map(readImage)).then((read) => setImages((all) => [...all, ...read]),
      (error: unknown) => notifyError(error, "Could not attach the images", sessionId));
  };

  return (
    <div className="composer" data-testid="composer" onDragOver={(event) => {
      if ([...event.dataTransfer.items].some((item) => item.kind === "file" && item.type.startsWith("image/"))) event.preventDefault();
    }} onDrop={(event) => {
      const dropped = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
      if (!dropped.length) return;
      event.preventDefault();
      attach(dropped);
    }}>
      {matches.length > 0 && <ul ref={commandList} id={commandListId} role="listbox" aria-label="Slash commands" className="mention-list">
        {matches.map((command, index) => <li key={command.name} role="presentation">
          <button type="button" tabIndex={-1} role="option" id={`${commandListId}-${index}`} aria-selected={index === selected}
            className="mention-item flex justify-between gap-3" data-active={index === selected}
            onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCommand(command)}>
            /{command.name}{command.kind === "terminal" && <span className="ui-muted">Open in terminal</span>}
          </button>
        </li>)}
      </ul>}
      {mention && files.length > 0 && (
        <ul className="mention-list" data-testid="mention-list">
          {files.map((f, i) => (
            <li key={f}>
              <button
                className="mention-item"
                data-active={i === pick}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(f);
                }}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.length > 0 && (
        <div className="composer-images" data-testid="composer-images">
          {images.map((img, i) => (
            <button
              key={i}
              className="composer-image"
              title="Remove this image"
              aria-label={`Remove image ${i + 1}`}
              onClick={() => setImages(images.filter((_, j) => j !== i))}
            >
              <img
                src={`data:${img.mediaType};base64,${img.data}`}
                alt="Pasted"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
      <div className="composer-box">
        <OverflowMenu
          label="Prompt presets"
          items={PRESETS.map((preset) => ({
            label: preset.label,
            onSelect: () => {
              const next = preset.prompt + text;
              setText(next);
              requestAnimationFrame(() => {
                area.current?.focus();
                area.current?.setSelectionRange(next.length, next.length);
              });
            },
          }))}
        />
        <textarea
          ref={area}
          value={text}
          rows={1}
          spellCheck
          placeholder={working ? "Enter queues a message. Shift+Enter adds a line." : "Message the agent. Enter sends, Shift+Enter adds a line, @ mentions a file."}
          aria-label="Message"
          aria-controls={matches.length ? commandListId : undefined}
          aria-activedescendant={selected >= 0 ? `${commandListId}-${selected}` : undefined}
          data-testid="composer-input"
          onChange={(e) => {
            setText(e.target.value);
            const prefix = /^\/([\w:-]*)$/.exec(e.target.value)?.[1];
            if (prefix !== undefined && slash === undefined) onSlashOpen();
            setSlash(prefix?.toLowerCase());
            setCommandPick(0);
            setMention(prefix === undefined ? mentionAt(e.target.value, e.target.selectionStart) : null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (matches.length && !e.shiftKey) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                return setCommandPick((selected + step + matches.length) % matches.length);
              }
              const command = matches[selected];
              if ((e.key === "Enter" || e.key === "Tab") && command) {
                e.preventDefault();
                return chooseCommand(command);
              }
            }
            if (e.key === "Escape" && slash !== undefined) {
              e.preventDefault();
              e.stopPropagation();
              return setSlash(undefined);
            }
            if (mention && files.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                return setPick((pick + 1) % files.length);
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                return setPick((pick - 1 + files.length) % files.length);
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                return choose(files[pick] ?? files[0] ?? "");
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                return setMention(null);
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (pasted.length === 0) return;
            e.preventDefault();
            attach(pasted);
          }}
        />
      </div>
      <div className="composer-bar">
        {controls}
        <span className="flex-1" />
        {working && (
          <button
            className="send-button"
            aria-label="Stop"
            title="Stop"
            onClick={onStop}
            data-testid="chat-stop"
          >
            <Square size={14} />
          </button>
        )}
          <button
            className="send-button"
            aria-label={working ? "Queue message" : "Send"}
            title={working ? "Queue message (Enter)" : "Send (Enter)"}
            disabled={!text.trim() || sending}
            onClick={send}
            data-testid="chat-send"
          >
            <ArrowUp size={16} />
          </button>
      </div>
    </div>
  );
}
