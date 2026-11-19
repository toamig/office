import { migration001 } from "./001_init";
import { migration002 } from "./002_session_capture";
import { migration003 } from "./003_fanout";
import { migration004 } from "./004_task_record";
import { migration005 } from "./005_task_base_branch";
import { migration006 } from "./006_session_mode";
import { migration007 } from "./007_conversation_started";
import { migration008 } from "./008_pending_items";
import { migration009 } from "./009_session_kept";
import { migration010 } from "./010_chat_kinds";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Numbered, append-only. Never edit a migration that has shipped; add a new one. */
export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
];
