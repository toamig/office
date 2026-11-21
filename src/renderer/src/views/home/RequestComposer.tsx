import { ArrowUp } from "lucide-react";
import { useState } from "react";
import type { RequestResult } from "@shared/models";
import { openRequest, sendRequest } from "../../lib/request";
import { LinkButton, notifyError } from "../../ui";

export function RequestComposer() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<RequestResult>();
  const [busy, setBusy] = useState(false);
  const ask = async (): Promise<void> => {
    const request = text.trim();
    if (!request || busy) return;
    setBusy(true);
    try {
      setResult(await sendRequest(request));
      setText("");
    } catch (error) {
      notifyError(error, "Office could not act on that request", "request");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer">
      <form className="composer-box" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <textarea
          aria-label="Ask Office"
          placeholder="Ask Office to find, start, remember or save something"
          rows={1}
          maxLength={6000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void ask();
          }}
        />
        <button className="send-button" aria-label="Send request" disabled={!text.trim() || busy}>
          <ArrowUp size={16} />
        </button>
      </form>
      {busy && <p className="ui-muted mt-2" role="status">Working on your request...</p>}
      {!busy && result && (
        <div className="ui-line" role="status">
          <span className="ui-line-main">{result.message}</span>
          <LinkButton onClick={() => openRequest(result)}>Open</LinkButton>
        </div>
      )}
    </div>
  );
}
