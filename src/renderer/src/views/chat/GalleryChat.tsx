import { useState } from "react";
import type { ChatItem, TurnActivity } from "@shared/chat";
import { Button, SegmentedControl } from "../../ui";
import { LivePlan, ToolGroup, TurnStatus } from "./Activity";
import { ChatAssets } from "./ChatAssets";
import { Composer } from "./Composer";
import { slashMenu } from "./commands";
import { ChatMessage } from "./Messages";
import { QueuedMessage } from "./QueuedMessage";

const sampleImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAX0lEQVR42u3PMQ3AQAwEwUcXVm4C4kCkMYOvDSsYtrS00hCY87wDNRSokGPAgAEDBgzsDmSghgIVYsCAAQMGDCwPfAM1FKgQAwYMGDBgYHngDtRQoEIMGDBgwICB1YEfGmNV4tYMTL4AAAAASUVORK5CYII=";

const examples: ChatItem[] = [
  { kind: "user", id: "owner", text: "Build the preview using this reference.", images: 1 },
  { kind: "user", id: "brief", text: "Check the preview on a small screen before reporting back.", images: 0,
    brief: { title: "Review the dashboard", where: "Project worktree", done: "Preview opens and can be resized" } },
  { kind: "assistant", id: "assistant", streaming: false, thinking: "I’ll check the existing preview before making changes.",
    text: "I found the page and its local assets.\n\n![Landscape preview](design.png)\n\n| File | Use |\n| --- | --- |\n| index.html | Preview |\n| styles.css | Layout |\n\n```js\nconst message = 'A code block can use the full width of the chat column.';\n```" },
  { kind: "plan", id: "plan" },
  { kind: "interaction", id: "question", requestId: "sample-question", pending: false,
    interaction: { kind: "questions", questions: [{ question: "Which image should the preview use?", multiSelect: false,
      options: [{ label: "Landscape", description: "Use the attached reference." }, { label: "Project icon", description: "Use the current icon." }] }] },
    answer: { kind: "questions", answers: [{ choices: ["Landscape"] }] } },
  { kind: "interaction", id: "approve", requestId: "sample-plan", pending: false,
    interaction: { kind: "plan", plan: "1. Read the preview.\n2. Update the layout.\n3. Check the result." }, answer: { kind: "plan", approve: true } },
  { kind: "subagent", id: "subagent", task: "Review whether the preview and its file links can fit on a narrow screen beside the conversation", status: "done", progress: "", verdict: "The preview can use the existing address bar." },
  { kind: "tool", id: "edit", name: "Edit", input: { file_path: "src/preview/index.html", old_string: "<h1>Preview</h1>", new_string: "<h1>Dashboard</h1>" }, status: "done", output: "" },
  { kind: "tool", id: "mcp", name: "mcp_tool_call", input: { tool: "Search notes", arguments: { query: "Preview layouts" } }, status: "done", output: "Found the layout notes." },
  { kind: "error", message: "The requested model is unavailable" },
  { kind: "stopped", detail: "running the build" },
  { kind: "turn", ok: true, durationMs: 4250, error: undefined },
];

export function GalleryChat() {
  const [width, setWidth] = useState<"narrow" | "wide">("wide");
  const [since] = useState(() => Date.now() - 4200);
  const [working, setWorking] = useState(true);
  const [queued, setQueued] = useState("When it finishes, open the updated preview.");
  const [selection, setSelection] = useState<string>();
  const activity: TurnActivity = { startedAt: working ? since : undefined, durationMs: working ? undefined : 4200,
    plan: [{ text: "Read the preview", status: "completed" }, { text: "Update the layout", status: "in_progress" }, { text: "Check the result", status: "pending" }],
    tools: working ? [{ id: "command", label: "Running the preview build" }] : [] };
  const tools: Array<Extract<ChatItem, { kind: "tool" }>> = [
    { kind: "tool", id: "read", name: "Read", input: { file_path: "design.png" }, status: "done", output: "" },
    { kind: "tool", id: "search", name: "Grep", input: { pattern: "A long pattern that demonstrates how an activity row truncates within a narrow conversation" }, status: "done", output: "" },
    { kind: "tool", id: "command", name: "Bash", input: { command: "npm run dev", description: "the preview build" }, startedAt: since,
      status: working ? "running" : "done", output: "Listening on http://localhost:5173/" },
  ];
  const row = (item: ChatItem, index: number) => <ChatMessage key={"id" in item ? item.id : index} item={item} tool="Claude Code" working={working}
    onRecover={item.kind === "error" ? () => undefined : undefined} />;

  return <div className="grid w-full gap-3">
    <div className="w-fit">
      <SegmentedControl label="Chat width" value={width} onChange={(value) => setWidth(value === "narrow" ? "narrow" : "wide")}
        options={[{ value: "narrow", label: "Narrow" }, { value: "wide", label: "Wide" }]} />
    </div>
    <ChatAssets.Provider value={{ id: "gallery", sampleImage, openFile: setSelection, openPreview: setSelection }}>
      <div className="mx-auto w-full rounded-[var(--radius-md)] border border-[var(--line)]" style={{ maxWidth: width === "narrow" ? 420 : 960 }}>
        <div className="chat-column py-4">
          {examples.slice(0, 6).map(row)}
          <ToolGroup tools={tools}>{tools.map(row)}</ToolGroup>
          {examples.slice(6).map(row)}
          {queued && <QueuedMessage message={{ id: "gallery-queue", text: queued, images: 0 }} working={working}
            onEdit={async (text) => { setQueued(text); return true; }} onRemove={async () => { setQueued(""); return true; }}
            onSend={async () => { setWorking(false); setQueued(""); return true; }} />}
          <LivePlan steps={activity.plan} />
          <TurnStatus activity={activity} />
          <Composer sessionId="gallery" working={working} commands={slashMenu([], true, false)} onSlashOpen={() => undefined}
            onCommand={async () => false} onSend={async (text) => { setQueued(text); return true; }} onStop={() => setWorking(false)}
            controls={<Button size="sm" variant="ghost" onClick={() => setWorking(true)}>Restart sample turn</Button>} />
          {selection && <p className="ui-muted mt-2 truncate">Open beside: {selection}</p>}
        </div>
      </div>
    </ChatAssets.Provider>
  </div>;
}
