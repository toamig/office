import { migration001 } from "./001_init";
import { migration002 } from "./002_session_capture";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Numbered, append-only. Never edit a migration that has shipped; add a new one. */
export const migrations: Migration[] = [migration001, migration002];
