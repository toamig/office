import { useState } from "react";
import type { AgentInteraction, InteractionAnswer } from "@shared/models";
import { office } from "../lib/ipc";
import { Button, Input, notifyError } from "../ui";
import { Markdown } from "./Markdown";

const blank = { choices: [] as string[], other: "" };

export function InteractionCard({ requestId, interaction, pending, answer }: {
  requestId: string;
  interaction: AgentInteraction;
  pending: boolean;
  answer?: InteractionAnswer;
}) {
  const [choices, setChoices] = useState<Record<number, typeof blank>>({});
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const submit = (value: InteractionAnswer) => {
    setSending(true);
    void office.invoke("permissions.interact", { id: requestId, answer: value }).catch((error: unknown) => {
      notifyError(error, "Could not send the answer", requestId);
    }).finally(() => setSending(false));
  };

  if (interaction.kind === "plan") return <section className="ui-ask" aria-label="Review the agent's plan">
    <strong>Review the agent’s plan</strong>
    {interaction.plan && <Markdown>{interaction.plan}</Markdown>}
    {pending ? <div className="flex flex-wrap items-end gap-2">
      <Input label="Note for the agent" value={reason} onChange={(event) => setReason(event.target.value)} />
      <Button variant="primary" disabled={sending} onClick={() => submit({ kind: "plan", approve: true })}>Approve</Button>
      <Button disabled={sending} onClick={() => submit({ kind: "plan", approve: false, reason })}>Keep planning</Button>
    </div> : <p className="ui-muted">{answer?.kind === "plan" ? answer.approve ? "Approved" : `Keep planning${answer.reason ? `: ${answer.reason}` : ""}` : "Cancelled"}</p>}
  </section>;

  return <section className="ui-ask" aria-label="Questions from the agent">
    {interaction.questions.map((question, index) => {
      const selected = choices[index] ?? blank;
      const chosen = answer?.kind === "questions" ? answer.answers[index] : undefined;
      const change = (value: typeof blank) => setChoices((current) => ({ ...current, [index]: value }));
      return <fieldset key={index} disabled={sending} className="min-w-0 space-y-2">
        <legend className="font-semibold">{question.question}</legend>
        {pending ? <>
          <div className="grid gap-1">
            {question.options.map(({ label, description }, option) => {
              const active = selected.choices.includes(label);
              const body = <><span className="font-medium">{label}</span>{description && <span className="ui-muted">{description}</span>}</>;
              return question.multiSelect ? <label key={option} className="flex items-start gap-2 py-1">
                <input type="checkbox" checked={active} onChange={() => change({ ...selected, choices: active
                  ? selected.choices.filter((entry) => entry !== label) : [...selected.choices, label] })} />
                <span className="grid">{body}</span>
              </label> : <Button key={option} variant={active ? "primary" : "secondary"} aria-pressed={active}
                onClick={() => change({ choices: [label], other: "" })}><span className="grid text-left">{body}</span></Button>;
            })}
          </div>
          <Input label="Other" value={selected.other} onChange={(event) => change({ choices: question.multiSelect ? selected.choices : [], other: event.target.value })} />
        </> : <div className="ui-muted">{chosen ? [...chosen.choices, chosen.other?.trim()].filter(Boolean).join(", ") : "Cancelled"}</div>}
      </fieldset>;
    })}
    {pending && <div><Button variant="primary" disabled={sending || interaction.questions.some((_, index) => {
      const selected = choices[index];
      return !selected?.choices.length && !selected?.other.trim();
    })} onClick={() => submit({ kind: "questions", answers: interaction.questions.map((_, index) => choices[index] ?? blank) })}>Submit answers</Button></div>}
  </section>;
}
