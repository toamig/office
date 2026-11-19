import { createContext, useContext } from "react";
import type { SessionRow } from "@shared/models";

/** What the panels of a session can ask the Sessions view to do: end the session by wrapping it up. */
export interface SessionActions {
  wrapUp: (session: SessionRow) => void;
}

export const SessionActionsContext = createContext<SessionActions>({ wrapUp: () => undefined });

export const useSessionActions = (): SessionActions => useContext(SessionActionsContext);
