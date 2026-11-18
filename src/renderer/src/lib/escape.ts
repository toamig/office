import { useEffect, useRef } from "react";

/** Open dialogs, newest last; Esc closes only the top one. */
const stack: Array<{ current: () => void }> = [];

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const top = stack[stack.length - 1];
    if (!top) return;
    e.preventDefault();
    top.current();
  });
}

/** Closes a dialog on Esc while it is open (`active`), the top-most dialog first. */
export function useEscape(onClose: () => void, active = true): void {
  const handler = useRef(onClose);
  useEffect(() => {
    handler.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    listen();
    stack.push(handler);
    return () => {
      const at = stack.indexOf(handler);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [active]);
}
