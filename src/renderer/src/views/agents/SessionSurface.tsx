import type { SessionRow } from "@shared/models";
import { ChatView } from "../chat/ChatView";
import { TerminalView } from "./TerminalView";
import { OfficeConfirmations } from "../../components/OfficeConfirmations";

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
  return (
    <div className="flex h-full min-h-0 w-full flex-col" key={session.id}>
      <TerminalView id={session.id} />
      {!session.incognito && <div className="max-h-[50%] overflow-auto px-4">
        <OfficeConfirmations sessionId={session.id} />
      </div>}
    </div>
  );
}
