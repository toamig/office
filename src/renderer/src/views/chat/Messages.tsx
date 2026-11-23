import { Bot, ChevronRight, CircleHelp, ClipboardList, Lightbulb, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatDuration, type ChatItem } from "@shared/chat";
import { chatFailure } from "@shared/chat-failure";
import { ChatImageView, ChatMarkdown as Markdown } from "./ChatAssets";
import { InteractionCard } from "../../components/InteractionCard";
import { Button, OverflowMenu, Textarea } from "../../ui";
import { ToolCard } from "./ToolCard";

/** Thinking is folded away under a toggle. */
function Thinking({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="thinking" data-testid="thinking">
      <button className="tool-head" onClick={() => setShown(!shown)} aria-expanded={shown}>
        <Lightbulb size={14} /><span className="tool-summary">Thinking</span>
        <ChevronRight size={13} className={shown ? "tool-chevron open" : "tool-chevron"} />
      </button>
      {shown && <div className="thinking-text text-selectable">{text}</div>}
    </div>
  );
}

function CardRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="chat-card-row"><span aria-hidden>{icon}</span><div className="min-w-0">{children}</div></div>;
}

/** One thing in the conversation: a bubble, an answer, a tool card, a quiet error, a turn footer. */
export function ChatMessage({ item, tool, working, onRecover, onEdit, onRewind }: {
  item: ChatItem;
  tool: string;
  working: boolean;
  onRecover?: (kind: ReturnType<typeof chatFailure>["kind"]) => void;
  onEdit?: (value: string) => Promise<boolean>;
  onRewind?: () => void;
}) {
  switch (item.kind) {
    case "user":
      return <OwnerMessage item={item} onEdit={onEdit} onRewind={onRewind} working={working} />;
    case "assistant":
      // A message that has not said anything yet is not drawn; the working dots stand in for it.
      if (!item.text && !item.thinking) return null;
      return (
        <div
          className="assistant text-selectable"
          data-testid="chat-assistant"
          data-streaming={item.streaming}
        >
          {item.thinking && <Thinking text={item.thinking} />}
          {item.text && <Markdown>{item.text}</Markdown>}
          {item.streaming && <span className="caret" aria-hidden />}
        </div>
      );
    case "tool":
      return <ToolCard tool={item} />;
    case "plan":
      return <div className="tool-head static"><ClipboardList size={14} /><span className="tool-summary">Updated the plan</span></div>;
    case "interaction":
      return <CardRow icon={item.interaction.kind === "plan" ? <ClipboardList size={14} /> : <CircleHelp size={14} />}>
        <InteractionCard requestId={item.requestId} interaction={item.interaction} pending={item.pending} answer={item.answer} />
      </CardRow>;
    case "subagent":
      return (
        <div className="tool-card" data-testid="subagent-card">
          <div className="tool-head static">
            <Bot size={14} />
            <span className="tool-summary" title={item.task}>{item.task}</span>
            <span className="ui-muted">{item.status === "working" ? "Working" : item.status === "done" ? "Done" : "Failed"}</span>
          </div>
          {item.progress && item.status === "working" && <p className="ui-muted px-3">{item.progress}</p>}
          {item.verdict && <div className="px-3"><Markdown>{item.verdict}</Markdown></div>}
        </div>
      );
    case "error": {
      const failure = chatFailure(item.message, tool);
      return (
        <CardRow icon={<TriangleAlert size={14} />}><div className="ui-ask text-selectable" data-testid="chat-error" role="status">
          <p>{failure.text}</p>
          {failure.kind === "unknown" && failure.details && <details>
            <summary className="cursor-pointer ui-muted">Details</summary>
            <pre className="whitespace-pre-wrap break-words">{failure.details}</pre>
          </details>}
          {onRecover && <div><Button size="sm" disabled={working} onClick={() => onRecover(failure.kind)}>{failure.action}</Button></div>}
        </div></CardRow>
      );
    }
    case "turn":
      return (
        <div className="turn-footer" data-testid="chat-turn" data-ok={item.ok}>
          Done
          {item.durationMs !== null && ` in ${formatDuration(item.durationMs)}`}
        </div>
      );
    case "stopped":
      return (
        <div className="turn-footer" data-testid="chat-stopped">
          {item.detail ? `Stopped while ${item.detail}` : "Stopped"}
        </div>
      );
  }
}

function OwnerMessage({ item, working, onEdit, onRewind }: {
  item: Extract<ChatItem, { kind: "user" }>;
  working: boolean;
  onEdit?: (value: string) => Promise<boolean>;
  onRewind?: () => void;
}) {
  const [draft, setDraft] = useState<string>();
  const [sending, setSending] = useState(false);
  const rewind = onRewind && !working && <OverflowMenu label="Message actions" items={[{
    label: "Restore files to before this", onSelect: onRewind,
  }]} />;
  if (item.brief) {
    return (
      <section className="office-brief text-selectable" data-testid="chat-user">
        <p className="ui-muted">Brief from Office</p>
        {rewind}
        <h3 className="font-semibold">{item.brief.title}</h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="ui-muted">Where</dt><dd className="break-words">{item.brief.where}</dd>
          <dt className="ui-muted">Done means</dt><dd>{item.brief.done}</dd>
        </dl>
        <details>
          <summary className="cursor-pointer ui-muted">Full brief</summary>
          <Markdown>{item.text}</Markdown>
        </details>
      </section>
    );
  }
  return (
    <div className="bubble-row user" data-testid="chat-user">
      <div className="bubble text-selectable">
        {draft === undefined ? <Markdown>{item.text}</Markdown> : (
          <Textarea label="Edit message" value={draft} rows={4} onChange={(event) => setDraft(event.target.value)} />
        )}
        {item.images > 0 && <div className="flex flex-wrap gap-2 py-1">
          {Array.from({ length: item.images }, (_, index) => <ChatImageView key={index} alt={`Attached image ${index + 1}`}
            source={{ kind: "attachment", messageId: item.id, index }} />)}
        </div>}
        {rewind}
        {onEdit && (draft === undefined
          ? <Button variant="ghost" size="sm" disabled={working} onClick={() => setDraft(item.text)}>Edit and resend</Button>
          : <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" onClick={() => setDraft(undefined)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={sending || working || !draft.trim()} onClick={() => {
              setSending(true);
              void onEdit(draft.trim()).then((sent) => { if (sent) setDraft(undefined); }).finally(() => setSending(false));
            }}>Resend</Button>
          </div>)}
      </div>
    </div>
  );
}
