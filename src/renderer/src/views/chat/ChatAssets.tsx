import { createContext, useContext, useEffect, useState } from "react";
import type { ChatImageSource } from "@shared/models";
import { Markdown } from "../../components/Markdown";
import { office } from "../../lib/ipc";
import { Button, Dialog } from "../../ui";

export const ChatAssets = createContext<{ id: string; openFile?: (path: string) => void; openPreview?: (url: string) => void } | null>(null);
export const isImagePath = (path: string) => /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path);
export const isLocalFile = (path: string) => !/^(?:#|\/\/)/.test(path) &&
  (!/^[a-z][a-z0-9+.-]*:/i.test(path) || /^(?:file:\/\/|[a-z]:[\\/])/i.test(path));

const isFileReference = (path: string) => isLocalFile(path) && /(?:[\\/]|\.[a-z][a-z\d]{0,11}$)/i.test(path);
export const isArtifactPath = (path: string) => isImagePath(path) || /\.(?:html?|xhtml|md|markdown|pdf)$/i.test(path);
export const wroteFile = (name: string) => ["Write", "Edit", "MultiEdit", "NotebookEdit", "apply_patch"].includes(name);

export function localAddress(value: string): string | undefined {
  const raw = value.match(/(?:^|[\s(])((?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):\d+(?:\/[^\s"'<>)]*)?)(?=$|[\s),;"'])/im)?.[1]?.replace(/[.,;]+$/, "");
  if (!raw) return;
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

function fileLink(value: string): string {
  if (/^file:/i.test(value)) return value;
  try { return decodeURIComponent(value); } catch { return value; }
}

function isLoopbackLink(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function toolPaths(input: Record<string, unknown>): string[] {
  const changes = input["changes"];
  if (Array.isArray(changes)) return [...new Set(changes.flatMap((entry: unknown) =>
    entry && typeof entry === "object" && "path" in entry && typeof entry.path === "string" ? [entry.path] : []))];
  const path = input["file_path"] ?? input["path"];
  return typeof path === "string" ? [path] : [];
}

export function ChatImageView({ source, alt, inline = false }: { source: ChatImageSource; alt: string; inline?: boolean }) {
  const id = useContext(ChatAssets)?.id;
  const [image, setImage] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [opened, setOpened] = useState(false);
  const path = source.kind === "file" ? source.path : undefined;
  const messageId = source.kind === "attachment" ? source.messageId : undefined;
  const index = source.kind === "attachment" ? source.index : undefined;
  useEffect(() => {
    if (!id) return;
    let current = true;
    const request: ChatImageSource | undefined = path !== undefined ? { kind: "file", path } :
      messageId && index !== undefined ? { kind: "attachment", messageId, index } : undefined;
    if (request) void office.invoke("chat.image", { id, source: request }).then((next) => {
      if (current) { setImage(next); setUnavailable(false); }
    }, () => { if (current) setUnavailable(true); });
    return () => { current = false; };
  }, [id, path, messageId, index]);
  if (!id || unavailable) return <span className="ui-muted">{alt} (unavailable)</span>;
  if (!image) return <span className="ui-muted">Loading {alt.toLowerCase()}</span>;
  return <>
    <button type="button" className={inline ? "chat-image inline" : "chat-image"} onClick={() => setOpened(true)} aria-label={`Open ${alt}`}>
      <img src={image} alt={alt} loading="lazy" onError={() => setUnavailable(true)} />
    </button>
    {opened && <Dialog title={alt} wide onClose={() => setOpened(false)} footer={<Button onClick={() => setOpened(false)}>Close</Button>}>
      <img className="mx-auto max-h-[72vh] max-w-full object-contain" src={image} alt={alt} />
    </Dialog>}
  </>;
}

export function ChatMarkdown({ children }: { children: string }) {
  const assets = useContext(ChatAssets);
  return <Markdown localLinks components={{
    img: ({ src, alt }) => src && isLocalFile(src) ? <ChatImageView key={src} source={{ kind: "file", path: fileLink(src) }} alt={alt || "Image"} inline /> : <span>{alt}</span>,
    a: ({ node: _node, href, children: label, ...props }) => {
      if (href && isLoopbackLink(href) && assets?.openPreview) return <button type="button" className="chat-link" onClick={() => assets.openPreview?.(href)}>{label}</button>;
      if (href && isFileReference(href) && assets?.openFile) return <button type="button" className="chat-link" onClick={() => assets.openFile?.(fileLink(href))}>{label}</button>;
      return <a {...props} href={href} target="_blank" rel="noreferrer">{label}</a>;
    },
    code: ({ node: _node, children: code, ...props }) => {
      if (typeof code === "string" && !props.className && !code.includes("\n")) {
        if (isLoopbackLink(code) && assets?.openPreview) return <button type="button" className="chat-link" onClick={() => assets.openPreview?.(code)}><code>{code}</code></button>;
        if (isFileReference(code) && assets?.openFile) return <button type="button" className="chat-link" onClick={() => assets.openFile?.(code)}><code>{code}</code></button>;
      }
      return <code {...props}>{code}</code>;
    },
  }}>
    {children}
  </Markdown>;
}
