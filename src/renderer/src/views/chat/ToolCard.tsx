import {
  Check,
  ChevronRight,
  CircleDashed,
  FileText,
  Pencil,
  Search,
  Terminal,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toolSummary, type ChatItem } from "@shared/chat";

type Tool = Extract<ChatItem, { kind: "tool" }>;

const READ_LIKE = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const EDIT_LIKE = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"]);

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function StatusIcon({ status }: { status: Tool["status"] }) {
  if (status === "done") return <Check size={13} style={{ color: "var(--good)" }} />;
  if (status === "error") return <X size={13} style={{ color: "var(--bad)" }} />;
  return <CircleDashed size={13} className="animate-spin" style={{ color: "var(--muted)" }} />;
}

/** A line-by-line diff of what an edit replaced, small enough to sit inside the conversation. */
function EditDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const removed = oldText === "" ? [] : oldText.split("\n");
  const added = newText === "" ? [] : newText.split("\n");
  return (
    <pre className="chat-diff" data-testid="edit-diff">
      {removed.map((line, i) => (
        <div key={`r${i}`} className="chat-diff-del">
          {`- ${line}`}
        </div>
      ))}
      {added.map((line, i) => (
        <div key={`a${i}`} className="chat-diff-add">
          {`+ ${line}`}
        </div>
      ))}
    </pre>
  );
}

/** A card that opens to show more (a command's output, a tool's raw input). */
function Collapsible({
  head,
  children,
  open = false,
}: {
  head: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  const [shown, setShown] = useState(open);
  return (
    <div>
      <button className="tool-head" onClick={() => setShown(!shown)} aria-expanded={shown}>
        <ChevronRight size={13} className={shown ? "tool-chevron open" : "tool-chevron"} />
        {head}
      </button>
      {shown && <div className="tool-body">{children}</div>}
    </div>
  );
}

/**
 * A tool call as a compact card: a file read or a search is one line, an edit shows its diff, a command
 * shows itself with its output folded away, a to-do list is a checklist, anything else folds its input.
 */
export function ToolCard({ tool }: { tool: Tool }) {
  const summary = toolSummary(tool.input);
  const head = (icon: ReactNode, label: string): ReactNode => (
    <>
      {icon}
      <span className="tool-name">{label}</span>
      <span className="tool-summary">{summary}</span>
      <span className="flex-1" />
      <StatusIcon status={tool.status} />
    </>
  );

  if (READ_LIKE.has(tool.name)) {
    return (
      <div className="tool-card" data-testid="tool-card" data-tool={tool.name}>
        <div className="tool-head static">
          {head(tool.name === "Read" ? <FileText size={13} /> : <Search size={13} />, tool.name)}
        </div>
      </div>
    );
  }

  if (EDIT_LIKE.has(tool.name)) {
    const oldText = text(tool.input["old_string"]);
    const newText = text(tool.input["new_string"]) || text(tool.input["content"]);
    return (
      <div className="tool-card" data-testid="tool-card" data-tool={tool.name}>
        <div className="tool-head static">{head(<Pencil size={13} />, tool.name)}</div>
        {(oldText || newText) && <EditDiff oldText={oldText} newText={newText} />}
      </div>
    );
  }

  if (tool.name === "Bash" || tool.name === "PowerShell") {
    return (
      <div className="tool-card" data-testid="tool-card" data-tool={tool.name}>
        <Collapsible head={head(<Terminal size={13} />, tool.name)}>
          <pre className="tool-output" data-testid="tool-output">
            {tool.output || (tool.status === "running" ? "Running..." : "(no output)")}
          </pre>
        </Collapsible>
      </div>
    );
  }

  if (tool.name === "TodoWrite" && Array.isArray(tool.input["todos"])) {
    const todos = tool.input["todos"] as Array<{ content?: string; status?: string }>;
    return (
      <div className="tool-card" data-testid="tool-card" data-tool="TodoWrite">
        <ul className="todo-list" data-testid="todo-list">
          {todos.map((t, i) => (
            <li key={i} data-status={t.status}>
              <span className="todo-box">
                {t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○"}
              </span>
              {t.content}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="tool-card" data-testid="tool-card" data-tool={tool.name}>
      <Collapsible head={head(<Terminal size={13} />, tool.name)}>
        <pre className="tool-output">{JSON.stringify(tool.input, null, 2)}</pre>
        {tool.output && <pre className="tool-output">{tool.output}</pre>}
      </Collapsible>
    </div>
  );
}
