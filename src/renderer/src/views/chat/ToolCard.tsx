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
import { useContext, useState, type ReactNode } from "react";
import { runningLabel, toolSummary, type ChatItem } from "@shared/chat";
import { Elapsed } from "./Activity";
import { ChatAssets, ChatImageView, isArtifactPath, isImagePath, localAddress, toolPaths } from "./ChatAssets";

type Tool = Extract<ChatItem, { kind: "tool" }>;

const READ_LIKE = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead"]);
const EDIT_LIKE = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"]);

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function StatusIcon({ status }: { status: Tool["status"] }) {
  if (status === "done") return <Check size={13} className="ui-good" />;
  if (status === "error") return <X size={13} className="ui-bad" />;
  return <CircleDashed size={13} className="animate-spin ui-muted" />;
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
 * shows itself with its output folded away, and other calls fold their input.
 */
export function ToolCard({ tool }: { tool: Tool }) {
  const assets = useContext(ChatAssets);
  const files = toolPaths(tool.input);
  const summary = toolSummary(tool.input);
  const images = tool.status === "done" && (READ_LIKE.has(tool.name) || EDIT_LIKE.has(tool.name))
    ? files.filter(isImagePath) : [];
  const links = assets?.openFile && files.length > 0 && <div className="flex flex-wrap gap-x-2 px-2 pb-1">
    {files.map((path) => <button type="button" key={path} className="chat-link truncate text-left" onClick={() => assets.openFile?.(path)} title={path}>
      {tool.status === "done" && EDIT_LIKE.has(tool.name) && isArtifactPath(path) ? `Open beside: ${path.split(/[\\/]/).at(-1)}` : path}
    </button>)}
  </div>;
  const thumbnails = images.length > 0 && <div className="flex flex-wrap gap-2 px-2 pb-2">
    {images.map((path) => <ChatImageView key={path} alt={path.split(/[\\/]/).at(-1) || "Image"} source={{ kind: "file", path }} />)}
  </div>;
  const head = (icon: ReactNode, label: string): ReactNode => (
    <>
      {icon}
      {tool.status === "running" && tool.startedAt !== undefined
        ? <><span className="tool-summary" title={runningLabel(tool)}>{runningLabel(tool)}</span>, <Elapsed since={tool.startedAt} /></>
        : <><span className="tool-name">{label}</span><span className="tool-summary">{summary}</span></>}
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
        {thumbnails}
        {links}
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
        {thumbnails}
        {links}
      </div>
    );
  }

  if (tool.name === "Bash" || tool.name === "PowerShell") {
    const address = localAddress(tool.output);
    return (
      <div className="tool-card" data-testid="tool-card" data-tool={tool.name}>
        <Collapsible head={head(<Terminal size={13} />, tool.name)}>
          <pre className="tool-output" data-testid="tool-output">
            {tool.output || (tool.status === "running" ? "Running..." : "(no output)")}
          </pre>
        </Collapsible>
        {address && assets?.openPreview && <button type="button" className="chat-link mx-2 mb-1" title={address} onClick={() => assets.openPreview?.(address)}>Open preview</button>}
      </div>
    );
  }

  return (
    <div className="tool-card" data-testid="tool-card" data-tool={tool.name}>
      <Collapsible head={head(<Terminal size={13} />, tool.name)}>
        <pre className="tool-output">{JSON.stringify(tool.input, null, 2)}</pre>
        {tool.output && <pre className="tool-output">{tool.output}</pre>}
      </Collapsible>
      {links}
    </div>
  );
}
