/**
 * Notifications are no longer a history: pop-ups are never kept and pending items are derived from live state.
 * The table stays as the alert ledger (what was already alerted), and a dismissed pending item is remembered with the
 * state it was dismissed in.
 */
export const migration008 = {
  id: 8,
  name: "pending items replace the notification history",
  sql: `DELETE FROM notifications;
CREATE TABLE dismissed_pending (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  dismissed_at TEXT NOT NULL
);`,
};
