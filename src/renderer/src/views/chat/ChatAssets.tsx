import { createContext, useContext, useEffect, useState } from "react";
import type { ChatImageSource } from "@shared/models";
import { Markdown } from "../../components/Markdown";
import { office } from "../../lib/ipc";
import { Button, Dialog } from "../../ui";

export const ChatAssets = createContext<{ id: string } | null>(null);
export const isImagePath = (path: string) => /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path);
export const isLocalFile = (path: string) => !/^(?:#|\/\/)/.test(path) &&
  (!/^[a-z][a-z0-9+.-]*:/i.test(path) || /^(?:file:\/\/|[a-z]:[\\/])/i.test(path));

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
  return <Markdown localLinks components={{ img: ({ src, alt }) => src && isLocalFile(src) ?
    <ChatImageView key={src} source={{ kind: "file", path: src }} alt={alt || "Image"} inline /> : <span>{alt}</span> }}>
    {children}
  </Markdown>;
}
