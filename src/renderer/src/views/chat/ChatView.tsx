import { GitBranch, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { emptyChat, reduceChat, replayChat, toolGroup, type ChatItem, type ChatState as Conversation } from "@shared/chat";
import type { ChatLine, ChatOptions, ChatState, SessionRow } from "@shared/models";
import { isChatSession } from "@shared/roles";
import { AutonomyPicker } from "../../components/AutonomyPicker";
import { formatTokens } from "../../components/UsageMeter";
import { useQuery } from "../../lib/hooks";
import { OfficeConfirmations } from "../../components/OfficeConfirmations";
import { PermissionRequests } from "../../components/PermissionRequests";
import { StatusChip } from "../../components/StatusChip";
import { useSessionActions } from "../../components/SessionActions";
import { office } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { Button, Dropdown, IconButton, OverflowMenu, SplitPane, notifyError } from "../../ui";
import { ToolRunDialog, type ToolRun } from "../setup/ToolRunDialog";
import { LivePlan, ToolGroup, TurnStatus } from "./Activity";
import { Composer } from "./Composer";
import { ChatAssets, isArtifactPath, toolPaths, wroteFile } from "./ChatAssets";
import { ChatSidePanel, type SideTab } from "./ChatSidePanel";
import { slashMenu, type SlashCommand } from "./commands";
import { ChatMessage } from "./Messages";
import { QueuedMessage } from "./QueuedMessage";
import { RewindDialog } from "./RewindDialog";

function useConversation(id: string): { conversation: Conversation; ready: boolean } {
  const [conversation, setConversation] = useState(emptyChat);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    let last = 0;
    let loaded = false;
    const waiting: ChatLine[] = [];
    const apply = (line: ChatLine) => {
      if (line.seq <= last) return;
      last = line.seq;
      setConversation((current) => reduceChat(current, line.event, Date.parse(line.at)));
    };
    const off = office.on("chat.event", (event) => {
      const payload = event.payload as { sessionId: string; line: ChatLine };
      if (payload.sessionId !== id) return;
      if (loaded) apply(payload.line);
      else waiting.push(payload.line);
    });
    void office.invoke("chat.history", { id }).then((lines) => {
      if (!alive) return;
      setConversation(replayChat(lines));
      last = lines.at(-1)?.seq ?? 0;
      loaded = true;
      for (const line of waiting.splice(0)) apply(line);
      setReady(true);
    });
    return () => { alive = false; off(); };
  }, [id]);
  return { conversation, ready };
}

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

function groupMessages(items: ChatItem[]) {
  const groups: Array<{ index: number; item: ChatItem } | { tools: ToolItem[] }> = [];
  for (const [index, item] of items.entries()) {
    if (item.kind === "assistant" && !item.text && !item.thinking) continue;
    if (item.kind === "tool" && item.status !== "error" && toolGroup(item.name)) {
      const last = groups.at(-1);
      if (last && "tools" in last) last.tools.push(item);
      else groups.push({ tools: [item] });
    } else groups.push({ index, item });
  }
  return groups;
}

function ChatChoices({ state, working, onChange }: {
  state: ChatState | null;
  working: boolean;
  onChange: (patch: ChatOptions) => void;
}) {
  const model = state?.options.model ?? "";
  const effort = state?.options.effort ?? "";
  const choices = state?.models ?? [];
  const efforts = model ? choices.find((choice) => choice.id === model)?.efforts ?? [] : state?.defaultModel?.efforts ?? [];
  return <>
    <Dropdown className="chat-select" aria-label="Model" data-testid="chat-model" value={model}
      disabled={!state || working} onChange={(event) => onChange({ model: event.target.value, effort: "" })}>
      <option value="">{state?.defaultModel
        ? `Default (${state.defaultModel.label}, the tool's default)`
        : "Default model"}</option>
      {model && !choices.some((choice) => choice.id === model) && <option value={model}>{model}</option>}
      {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </Dropdown>
    {efforts.length > 0 && <Dropdown className="chat-select" aria-label="Effort" value={efforts.includes(effort) ? effort : ""}
      disabled={working} onChange={(event) => onChange({ effort: event.target.value as ChatOptions["effort"] })}>
      <option value="">Default effort</option>
      {efforts.map((level) => <option key={level} value={level}>{level === "xhigh" ? "Extra high" : level.charAt(0).toUpperCase() + level.slice(1)}</option>)}
    </Dropdown>}
  </>;
}

export function ChatView({ session, onChanged, headerActions }: {
  session: SessionRow;
  onChanged: () => void;
  headerActions?: ReactNode;
}) {
  const id = session.id;
  const plain = isChatSession(session);
  const { conversation, ready } = useConversation(id);
  const { items, working, activity, queue } = conversation;
  const panelKey = `office.chat-panel:${id}`;
  // The side panel is hidden, beside the chat, or filling the chat area; which one is remembered per chat.
  const [panelMode, setPanelMode] = useState<"hidden" | "side" | "full">(() => {
    const saved = session.incognito ? null : localStorage.getItem(panelKey);
    return saved === "full" ? "full" : saved === "1" ? "side" : "hidden";
  });
  const panelVisible = panelMode !== "hidden";
  const [sideTab, setSideTab] = useState<SideTab>("preview");
  const [sideFile, setSideFile] = useState<string>();
  const [sideUrl, setSideUrl] = useState<string>();
  const latestArtifact = useRef<string | undefined>(undefined);
  const [state, setState] = useState<ChatState | null>(null);
  const [login, setLogin] = useState<{ messageId: string; run: ToolRun }>();
  const [discovered, setDiscovered] = useState<string[]>();
  const [rewind, setRewind] = useState<{ messageId?: string }>();
  const navigate = useUi((store) => store.navigate);
  const chat = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const reveal = useCallback(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const { wrapUp } = useSessionActions();
  const used = useQuery("usage.session", { sessionId: id }, ["usage.changed"]).data?.tokens ?? 0;

  const setMode = (mode: "hidden" | "side" | "full") => {
    setPanelMode(mode);
    if (!session.incognito) localStorage.setItem(panelKey, mode === "full" ? "full" : mode === "side" ? "1" : "0");
  };
  const showPanel = (show: boolean) => setMode(show ? (panelMode === "full" ? "full" : "side") : "hidden");
  const openFile = (path: string) => {
    setSideFile(path);
    setSideTab("file");
    showPanel(true);
  };
  const openPreview = (url: string) => {
    setSideUrl(url);
    setSideTab("preview");
    showPanel(true);
  };

  // An agent can ask for a page or a file to be shown beside the chat.
  useEffect(() => office.on("chat.preview", (event) => {
    const request = event.payload as { sessionId: string; url?: string; path?: string };
    if (request.sessionId !== id) return;
    if (request.url) openPreview(request.url);
    else if (request.path) openFile(request.path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [id]);
  // Esc returns the full-screen panel to its place beside the chat.
  useEffect(() => {
    if (panelMode !== "full") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) setMode("side"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelMode]);

  useEffect(() => {
    if (!ready) return;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item?.kind !== "tool" || item.status !== "done" || !wroteFile(item.name)) continue;
      const path = toolPaths(item.input).findLast(isArtifactPath);
      if (!path) continue;
      if (latestArtifact.current !== item.id && panelVisible && sideTab === "file") setSideFile(path);
      latestArtifact.current = item.id;
      break;
    }
  }, [items, ready, panelVisible, sideTab]);

  useEffect(() => {
    let request = 0;
    const load = () => {
      const seq = ++request;
      void office.invoke("chat.state", { id }).then((next) => {
        if (request === seq) setState(next);
      }, () => undefined);
    };
    load();
    const off = office.on("chat.state", (event) => {
      if ((event.payload as { sessionId?: string }).sessionId === id) load();
    });
    return () => { request++; off(); };
  }, [id]);

  useEffect(() => { if (pinned.current) reveal(); }, [conversation, reveal]);

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      return true;
    } catch (error) {
      notifyError(error, "Could not complete the chat action", id);
      return false;
    }
  };
  const toolLabel = state?.kind === "codex" || session.provider === "codex" ? "Codex" : "Claude Code";
  const claude = toolLabel === "Claude Code";
  const openTerminal = () => act(async () => {
    await office.invoke("chat.toTerminal", { id });
    onChanged();
  });
  const choices = slashMenu(conversation.commands.length ? conversation.commands : discovered ?? [], claude, !plain);
  const command = (entry: SlashCommand): Promise<boolean> => {
    if (entry.kind === "terminal") return working ? act(async () => {
      throw new Error("Finish or stop the turn before opening it in the terminal.");
    }) : openTerminal();
    return act(async () => {
      switch (entry.name) {
        case "model":
        case "effort": {
          const label = entry.name === "model" ? "Model" : "Effort";
          const picker = chat.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
          if (!picker || picker.disabled) throw new Error(`${label} is unavailable for this turn or model.`);
          picker.focus();
          picker.click();
          break;
        }
        case "clear":
          await office.invoke("chat.clear", { id });
          break;
        case "resume":
          navigate("agents");
          break;
        case "rewind":
          setRewind({});
          break;
      }
    });
  };
  const resend = (messageId: string, text?: string, useDefault?: boolean) =>
    act(() => office.invoke("chat.resend", { id, messageId, text, useDefault }));
  const signIn = (messageId: string) => void act(async () => {
    const loginSession = await office.invoke("setup.loginSession", { id: session.provider });
    setLogin({ messageId, run: {
      session: loginSession, kind: "login", toolId: session.provider, toolLabel,
      again: () => signIn(messageId),
    } });
  });
  const lastOwner = items.findLast((item) => item.kind === "user")?.id;
  const snapshots = new Set(conversation.snapshots);
  const retryTargets = new Map<number, string>();
  let lastMessage: string | undefined;
  for (const [index, item] of items.entries()) {
    if (item.kind === "user") lastMessage = item.id;
    if (item.kind === "error" && lastMessage) retryTargets.set(index, lastMessage);
  }
  return (
    <ChatAssets.Provider value={{ id, openFile, openPreview }}>
    <SplitPane id={session.incognito ? "chat-side-incognito" : `chat-side:${id}`} fixedSide="right"
      defaultSize={430} min={280} minSecond={280} showSecond={panelVisible} fullSecond={panelMode === "full"} secondWhenNarrow label="Resize chat side panel"
      second={<ChatSidePanel session={session} tab={sideTab} path={sideFile} url={sideUrl} onTab={setSideTab} full={panelMode === "full"}
        onFull={() => setMode(panelMode === "full" ? "side" : "full")} onClose={() => showPanel(false)} />} first={
    <div className="chat" ref={chat} data-testid="chat" data-session={id}>
      <header className="chat-header" data-testid="chat-header">
        <span className="pane-title">{session.title ?? session.provider}</span>
        <StatusChip status={session.status} />
        {used > 0 && <span className="ui-muted tabular-nums" title="Tokens this session has used, as the program reported them" data-testid="session-tokens">{formatTokens(used)}</span>}
        {session.branch && <span className="pane-branch"><GitBranch size={12} />{session.branch}</span>}
        <div className="flex-1" />
        {!plain && <Button size="sm" onClick={() => wrapUp(session)} data-testid="wrap-up">Wrap up</Button>}
        {!panelVisible && <IconButton size="sm" label="Show chat side panel" onClick={() => showPanel(true)}><PanelRightOpen /></IconButton>}
        {headerActions}
      </header>
      <div className="chat-scroll" ref={list} data-testid="chat-scroll" onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}>
        <div className="chat-column">
          {ready && items.length === 0 && <div className="chat-empty" data-testid="chat-empty">
            {plain ? "Ask a question or request an Office action." : "Ask the agent anything about this project."}
          </div>}
          {groupMessages(items).map((group) => {
            if ("tools" in group) return <ToolGroup key={group.tools[0]?.id} tools={group.tools}>
              {group.tools.map((item) => <ChatMessage key={item.id} item={item} tool={toolLabel} working={working} />)}
            </ToolGroup>;
            const { item, index } = group;
            const messageId = retryTargets.get(index);
            return <ChatMessage key={`${item.kind}-${"id" in item ? item.id : index}`} item={item} tool={toolLabel} working={working}
              onRewind={item.kind === "user" && snapshots.has(item.id) ? () => setRewind({ messageId: item.id }) : undefined}
              onEdit={item.kind === "user" && !item.brief && item.id === lastOwner
                ? (text) => resend(item.id, text) : undefined}
              onRecover={item.kind === "error" && messageId ? (kind) => {
                if (kind === "login") signIn(messageId);
                else void resend(messageId, undefined, kind === "model");
              } : undefined} />;
          })}
          <PermissionRequests compact runId={id} />
          {!session.incognito && <OfficeConfirmations sessionId={id} onReveal={reveal} />}
          {working && !items.some((item) => item.kind === "assistant" && item.streaming && item.text) &&
            <div className="working-dots" data-testid="chat-working" aria-label="Working"><span /><span /><span /></div>}
          {queue.map((message) => <QueuedMessage key={message.id} message={message} working={working}
            onEdit={(text) => act(() => office.invoke("chat.queueEdit", { id, messageId: message.id, text }))}
            onRemove={() => act(() => office.invoke("chat.queueRemove", { id, messageId: message.id }))}
            onSend={() => act(() => office.invoke("chat.queueSend", { id, messageId: message.id }))} />)}
        </div>
      </div>
      <div className="chat-column pb-4">
        <LivePlan steps={activity.plan} />
        <TurnStatus activity={activity} />
        <Composer sessionId={id} working={working}
          commands={choices} onCommand={command}
          onSlashOpen={() => {
            if (claude && !conversation.commands.length && discovered === undefined) {
              void office.invoke("chat.commands", { id }).then(setDiscovered, () => undefined);
            }
          }}
          onSend={(text, images) => act(() => office.invoke("chat.send", { id, text, images }))}
          onStop={() => void act(() => office.invoke("chat.stop", { id }))}
          controls={<>
            <ChatChoices state={state} working={working} onChange={(options) => {
              void act(() => office.invoke("chat.setOptions", { id, options }));
            }} />
            {!plain && session.autonomy && <AutonomyPicker value={session.autonomy} disabled={working}
              onChange={(level) => office.invoke("sessions.setAutonomy", { id, level }).then(onChanged)} />}
            {!plain && <OverflowMenu label="More about this session" testId="chat-more" items={[{
              label: "Open in terminal", testId: "open-in-terminal",
              onSelect: () => void openTerminal(),
            }]} />}
          </>} />
      </div>
      {login && <ToolRunDialog key={login.run.session.id} run={login.run} onClose={() => setLogin(undefined)}
        onSuccess={() => void resend(login.messageId)} />}
      {rewind && <RewindDialog id={id} initialMessage={rewind.messageId}
        messages={items.filter((item) => item.kind === "user").filter((item) => snapshots.has(item.id)).reverse()}
        terminal={claude && !plain && !working ? openTerminal : undefined} onClose={() => setRewind(undefined)} />}
    </div>} />
    </ChatAssets.Provider>
  );
}
