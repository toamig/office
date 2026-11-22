import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatImage } from "@shared/models";
import { office } from "../../lib/ipc";
import { OverflowMenu } from "../../ui";

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
 * is attached, and while a turn runs the send button becomes Stop.
 */
export function Composer({
  sessionId,
  working,
  onSend,
  onStop,
  controls,
}: {
  sessionId: string;
  working: boolean;
  onSend: (text: string, images: ChatImage[]) => void;
  onStop: () => void;
  controls?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [mention, setMention] = useState<{ from: number; query: string } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [pick, setPick] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);

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

  const send = (): void => {
    const body = text.trim();
    if (!body || working) return;
    onSend(body, images);
    setText("");
    setImages([]);
  };

  return (
    <div className="composer" data-testid="composer">
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
          placeholder="Message the agent. Enter sends, Shift+Enter adds a line, @ mentions a file."
          aria-label="Message"
          data-testid="composer-input"
          onChange={(e) => {
            setText(e.target.value);
            setMention(mentionAt(e.target.value, e.target.selectionStart));
          }}
          onKeyDown={(e) => {
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
            void Promise.all(pasted.map(readImage)).then((read) =>
              setImages((all) => [...all, ...read]),
            );
          }}
        />
      </div>
      <div className="composer-bar">
        {controls}
        <span className="flex-1" />
        {working ? (
          <button
            className="send-button"
            aria-label="Stop"
            title="Stop"
            onClick={onStop}
            data-testid="chat-stop"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            className="send-button"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!text.trim()}
            onClick={send}
            data-testid="chat-send"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
