import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatImage, ChatImageSource } from "../../../shared/models";
import { IpcFailure } from "../../core/ipc";

const images = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"],
  [".webp", "image/webp"], [".avif", "image/avif"], [".bmp", "image/bmp"], [".ico", "image/x-icon"], [".svg", "image/svg+xml"],
]);

export const imageMime = (path: string) => images.get(extname(path).toLowerCase());
const imageTypes = new Set(images.values());

export interface FileScope { cwd: string; roots: string[]; private: string[] }

export function insideFolder(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function scopedFile(scope: FileScope, path: string): Promise<string> {
  const refused = () => new IpcFailure("file-scope", "This file is outside the folders available to this chat.");
  try {
    const raw = /^file:/i.test(path) ? fileURLToPath(path) : path;
    if (!raw || raw.includes("\0") || raw.split(/[\\/]/).some((part) => part === ".." || part.toLowerCase() === ".git") ||
      (process.platform === "win32" && raw.replace(/^[a-z]:[\\/]/i, "").includes(":"))) throw refused();
    const lexical = resolve(scope.cwd, raw);
    const file = await realpath(lexical);
    const blocked = await Promise.all(scope.private.map(async (root) => realpath(root).catch(() => resolve(root))));
    if (blocked.some((root) => insideFolder(root, lexical) || insideFolder(root, file))) throw refused();
    const folders = await Promise.all(scope.roots.map(async (root) => ({ root: resolve(root), real: await realpath(root).catch(() => undefined) })));
    if (!folders.some(({ root, real }) => real && (insideFolder(root, lexical) || insideFolder(real, lexical)) && insideFolder(real, file))) throw refused();
    if (file.split(/[\\/]/).some((part) => part.toLowerCase() === ".git") || !(await stat(file)).isFile()) throw refused();
    return file;
  } catch {
    throw refused();
  }
}

export class ChatImages {
  private readonly secret = randomBytes(32);

  constructor(
    private readonly scope: (id: string) => FileScope,
    private readonly attachment: (id: string, messageId: string, index: number) => ChatImage | undefined,
  ) {}

  private sign(payload: string): Buffer {
    return createHmac("sha256", this.secret).update(payload).digest();
  }

  async url(id: string, source: ChatImageSource): Promise<string> {
    await this.resolve(id, source);
    const payload = Buffer.from(JSON.stringify([id, source])).toString("base64url");
    return `office-file://image/${payload}/${this.sign(payload).toString("base64url")}`;
  }

  async read(url: string) {
    const target = new URL(url);
    const [payload, signature] = target.pathname.slice(1).split("/");
    if (target.hostname !== "image" || !payload || !signature) return;
    const token = Buffer.from(signature, "base64url");
    const expected = this.sign(payload);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) return;
    const [id, source] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as [string, ChatImageSource];
    return this.resolve(id, source);
  }

  private async resolve(id: string, source: ChatImageSource): Promise<{ mime: string; file?: string; bytes?: Buffer }> {
    if (source.kind === "attachment") {
      const image = this.attachment(id, source.messageId, source.index);
      if (image && imageTypes.has(image.mediaType)) return { mime: image.mediaType, bytes: Buffer.from(image.data, "base64") };
    } else {
      const file = await scopedFile(this.scope(id), source.path);
      const mime = imageMime(file);
      if (mime) return { mime, file };
    }
    throw new IpcFailure("image-unavailable", "This image is unavailable.");
  }
}
