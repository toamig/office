import type { SessionRow } from "@shared/models";
import { ChatView } from "../chat/ChatView";
import { TerminalView } from "./TerminalView";

/**
 * What a session shows: a chat for a chat session, the embedded terminal for a terminal one. The terminal
 * is the real program, so slash commands and logins work there; both modes carry on the same conversation.
 */
export function SessionSurface({
  session,
  onChanged,
}: {
  session: SessionRow;
  onChanged: () => void;
}) {
  if (session.mode === "chat")
    return <ChatView key={session.id} session={session} onChanged={onChanged} />;
  return <TerminalView key={session.id} id={session.id} />;
}
