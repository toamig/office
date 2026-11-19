import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AskResult } from "@shared/models";
import { Markdown } from "../../components/Markdown";
import { Button, Card, Dropdown, EmptyState, Input, LinkButton } from "../../ui";
import { office } from "../../lib/ipc";
import { useQuery } from "../../lib/hooks";

interface Turn {
  id: number;
  question: string;
  runId: string | null;
  streamed: string;
  result: AskResult | null;
  error?: string;
}

/** Ask the brain: each question is a headless researcher run, answered from the vault with citations. */
export function AskPanel({ onOpenNote }: { onOpenNote: (path: string) => void }) {
  const projects = useQuery("projects.list");
  const [scope, setScope] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const offProgress = office.on("run.progress", (e) => {
      const p = e.payload as {
        runId: string;
        kind: string;
        event: { kind: string; text?: string };
      };
      if (p.kind !== "ask" || p.event.kind !== "text" || !p.event.text) return;
      const text = p.event.text;
      setTurns((all) =>
        all.map((t) => (t.runId === p.runId ? { ...t, streamed: `${t.streamed}${text}` } : t)),
      );
    });
    const offDone = office.on("run.done", (e) => {
      const p = e.payload as { runId: string; kind: string };
      if (p.kind !== "ask") return;
      void office.invoke("ask.result", { runId: p.runId }).then((result) => {
        setTurns((all) => all.map((t) => (t.runId === p.runId ? { ...t, result } : t)));
      });
    });
    return () => {
      offProgress();
      offDone();
    };
  }, []);

  const send = async (): Promise<void> => {
    const text = question.trim();
    if (!text) return;
    const id = nextId.current++;
    setQuestion("");
    setTurns((all) => [...all, { id, question: text, runId: null, streamed: "", result: null }]);
    try {
      const { runId } = await office.invoke("ask.start", {
        question: text,
        ...(scope ? { projectId: scope } : {}),
      });
      setTurns((all) => all.map((t) => (t.id === id ? { ...t, runId } : t)));
    } catch (err) {
      setTurns((all) =>
        all.map((t) => (t.id === id ? { ...t, error: (err as Error).message } : t)),
      );
    }
  };

  return (
    <Card title="Ask the brain" testId="panel-ask">
      <div className="mb-3 flex items-center gap-2">
        <span className="ui-muted">Scope</span>
        <Dropdown
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          aria-label="Scope"
          data-testid="ask-scope"
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Dropdown>
      </div>
      <div className="mb-3 max-h-[46vh] overflow-auto" data-testid="ask-turns">
        {turns.length === 0 && (
          <EmptyState title="Ask about your projects">
            Answers come from the notes, with the files they used.
          </EmptyState>
        )}
        {turns.map((t) => (
          <div key={t.id} className="mb-3" data-testid="ask-turn">
            <div className="mb-1 font-medium">{t.question}</div>
            {t.error && <div className="ui-line-sub ui-bad">{t.error}</div>}
            {!t.result && !t.error && (
              <div className="ui-muted">
                {t.streamed ? <Markdown>{t.streamed}</Markdown> : "Reading the notes..."}
              </div>
            )}
            {t.result && (
              <div data-testid="ask-answer">
                {!t.result.ok && (
                  <div className="ui-line-sub ui-bad">
                    {t.result.error ?? "The question failed"}
                  </div>
                )}
                <Markdown>{t.result.text}</Markdown>
                {t.result.citations.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="ui-muted">Sources</span>
                    {t.result.citations.map((c) => (
                      <LinkButton key={c} onClick={() => onOpenNote(c)} data-testid="citation">
                        {c}
                      </LinkButton>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          className="flex-1"
          label="Question"
          hideLabel
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What is the state of the Alpha game?"
          data-testid="ask-input"
        />
        <Button variant="primary" type="submit" data-testid="ask-send">
          <Send /> Ask
        </Button>
      </form>
      <p className="ui-muted mb-0 mt-2">One question runs one headless researcher session.</p>
    </Card>
  );
}
