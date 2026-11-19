import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePending } from "../lib/pending";
import { useUi } from "../stores/ui";
import { Button, CountPill, EmptyState } from "../ui";
import { dismissPending, kindName, useOpenPending } from "./PendingList";

/**
 * The bell in the top bar: what waits on the owner, and nothing else. The badge counts the items in the colour of the
 * most serious one; with none there is no badge. Clicking an item opens the place where it is resolved.
 */
export function PendingBell() {
  const { items, worst } = usePending();
  const navigate = useUi((s) => s.navigate);
  const open = useOpenPending();
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setShown(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setShown(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [shown]);
  return (
    <div className="bell-host" ref={box}>
      <button
        className="bar-button"
        aria-label={items.length > 0 ? `Needs you, ${items.length} waiting` : "Needs you"}
        title="Needs you"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
        data-testid="bell"
      >
        <Bell size={16} />
        {worst && (
          <span className="bell-count" data-testid="bell-count" data-tone={worst}>
            <CountPill count={items.length} tone={worst} />
          </span>
        )}
      </button>
      {shown && (
        <div className="ui-popover" data-testid="pending-popover">
          {items.length === 0 && (
            <EmptyState title="Nothing needs you">
              What waits on you shows here until you have dealt with it.
            </EmptyState>
          )}
          {items.map((item) => (
            <div key={item.key} className="ui-row" data-testid="bell-item" data-kind={item.kind}>
              <button
                className="bell-item-main"
                onClick={() => {
                  setShown(false);
                  open(item);
                }}
                data-testid="bell-open"
              >
                <span className="ui-toast-title">{item.title}</span>
                <span className="ui-toast-detail">
                  {kindName(item.kind)}
                  {item.detail ? `, ${item.detail}` : ""}
                </span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void dismissPending(item)}
                data-testid="bell-dismiss"
              >
                Dismiss
              </Button>
            </div>
          ))}
          {items.length > 0 && (
            <div className="p-2">
              <Button
                size="sm"
                onClick={() => {
                  setShown(false);
                  navigate("inbox");
                }}
                data-testid="bell-all"
              >
                Open Needs you
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
