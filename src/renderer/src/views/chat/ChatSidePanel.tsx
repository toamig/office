import { ExternalLink, FolderOpen, PanelRightClose, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatFile, PreviewBounds, SessionRow } from "@shared/models";
import { useNativeBounds } from "../../lib/native-bounds";
import { office } from "../../lib/ipc";
import { EmptyState, IconButton, Tabs, notifyError } from "../../ui";
import { PreviewTab } from "../PreviewTab";
import { DiffTab } from "../git/DiffTab";
import { ChatImageView, ChatMarkdown } from "./ChatAssets";

export type SideTab = "preview" | "file" | "changes";
const tabs = [
  { id: "preview", label: "Preview" }, { id: "file", label: "File" }, { id: "changes", label: "Changes" },
] satisfies Array<{ id: SideTab; label: string }>;

const tokens = /(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|#[^\r\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:import|export|from|const|let|function|return|class|if|else|for|while|throw|async|await|true|false|null|undefined|def|int|bool|struct|enum|using)\b|\b\d+(?:\.\d+)?\b)/g;

function Code({ text }: { text: string }) {
  return <pre className="tool-output h-full max-h-none p-3 text-selectable"><code>{text.split(tokens).map((token, index) =>
    index % 2 === 0 ? token : <span key={index} className={/^\/|^#/.test(token) ? "ui-muted" : /^["']/.test(token) ? "ui-good" : "ui-accent"}>{token}</span>,
  )}</code></pre>;
}

function NativeFile({ id, path, revision }: { id: string; path: string; revision: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useNativeBounds(holder, useCallback((bounds: PreviewBounds) => {
    void office.invoke("chat.previewFileBounds", { id, ...bounds });
  // A reload replaces the native surface, including its remembered bounds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, revision]));
  useEffect(() => {
    let current = true;
    void office.invoke("chat.previewFile", { id, path }).then(() => { if (current) setError(undefined); }, (failure: unknown) => {
      if (current) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      current = false;
      void office.invoke("chat.closeFilePreview", { id });
    };
  }, [id, path, revision]);
  return <div ref={holder} className="ui-preview-holder min-h-24">
    {error && <EmptyState title="Could not preview the file">{error}</EmptyState>}
  </div>;
}

function FileTab({ id, path }: { id: string; path: string }) {
  const [result, setResult] = useState<ChatFile>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    void office.invoke("chat.file", { id, path }).then((file) => {
      if (current) { setResult(file); setError(undefined); }
    }, (failure: unknown) => {
      if (current) { setResult(undefined); setError(failure instanceof Error ? failure.message : String(failure)); }
    });
    return () => { current = false; };
  }, [id, path, revision]);
  const action = (kind: "open" | "reveal") => void office.invoke("chat.fileAction", { id, path, action: kind }).catch((failure: unknown) => {
    notifyError(failure, "Could not open the file", id);
  });
  const kind = result?.kind;
  return <>
    <div className="flex min-w-0 items-center gap-1 border-b border-[var(--line)] p-2">
      <div className="min-w-0 flex-1 truncate font-medium" title={path}>{result?.name ?? path}</div>
      <IconButton size="sm" label="Reload file" onClick={() => setRevision((value) => value + 1)}><RefreshCw /></IconButton>
      <IconButton size="sm" label="Open in system app" disabled={!result || kind === "binary"} onClick={() => action("open")}><ExternalLink /></IconButton>
      <IconButton size="sm" label="Reveal in folder" disabled={!result} onClick={() => action("reveal")}><FolderOpen /></IconButton>
    </div>
    {error && <EmptyState title="File unavailable">{error}</EmptyState>}
    {!result && !error && <p className="ui-muted p-3" role="status">Loading file…</p>}
    {(kind === "html" || kind === "pdf") && <NativeFile id={id} path={path} revision={revision} />}
    {kind === "image" && <div className="overflow-auto p-3"><ChatImageView key={revision} alt={result!.name} source={{ kind: "file", path }} inline /></div>}
    {kind === "markdown" && <div className="overflow-auto p-3"><ChatMarkdown relativeTo={path}>{result?.text ?? ""}</ChatMarkdown></div>}
    {kind === "text" && <div className="min-h-0 flex-1 overflow-auto"><Code text={result?.text ?? ""} /></div>}
    {kind === "binary" && <EmptyState title="No inline preview for this file" />}
  </>;
}

export function ChatSidePanel({ session, tab, path, url, onTab, onClose }: {
  session: SessionRow; tab: SideTab; path?: string; url?: string;
  onTab: (tab: SideTab) => void; onClose: () => void;
}) {
  return <aside className="flex h-full min-w-0 flex-col border-l border-[var(--line)]" aria-label="Chat side panel">
    <div className="flex items-center justify-between border-b border-[var(--line)] px-2">
      <Tabs items={tabs} value={tab} onChange={onTab} label="Chat side panel" />
      <IconButton size="sm" label="Hide chat side panel" onClick={onClose}><PanelRightClose /></IconButton>
    </div>
    {tab === "file" && (path ? <FileTab key={path} id={session.id} path={path} /> :
      <EmptyState title="No file open">Select a file in the conversation to open it here.</EmptyState>)}
    {tab === "preview" && <div className="min-h-0 flex-1">
      <PreviewTab projectId={session.projectId ?? session.id} owner={session.id} initialUrl={url} transient={session.incognito} />
    </div>}
    {tab === "changes" && <div className="min-h-0 flex-1 overflow-auto p-3">
      {session.projectId ? <DiffTab projectId={session.projectId} workingDir={session.cwd} inspect={false} /> :
        <EmptyState title="No project changes">This conversation has no project worktree.</EmptyState>}
    </div>}
  </aside>;
}
