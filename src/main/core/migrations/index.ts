import { migration001 } from "./001_init";
import { migration002 } from "./002_session_capture";
import { migration003 } from "./003_fanout";
import { migration004 } from "./004_task_record";
import { migration005 } from "./005_task_base_branch";

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
];
