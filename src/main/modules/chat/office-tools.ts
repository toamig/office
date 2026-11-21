import { randomUUID } from "node:crypto";
import type { NotificationLink, SessionRow } from "../../../shared/models";
import type { OfficeConfirmation } from "../../../shared/office-tools";
import type { Project } from "../../../shared/types";
import { Workflow, workflowsFor, type Workflow as WorkflowDefinition } from "../../../shared/workflow";
import type { AppContext } from "../../context";
import { validCron } from "../../core/scheduler";
import { reminderDate } from "../ask/router";
import { slugify } from "../explore/files";
import { readNote } from "../notes/notes";
import { privateNotes } from "../vault/scope";
import { fieldsPreview, officeCatalog, parseOfficeCall, toolFields, workflowPreview, type OfficeCall } from "./office-tool-plan";

type Deps = Pick<AppContext, "bus" | "sessions" | "settings" | "store" | "scheduler" | "editor" | "explore" | "recorder" | "ops" | "tasks">;
type Output = Record<string, unknown>;
type Mutation = {
  title: string;
  run: () => Promise<Output>;
  fields: OfficeConfirmation["fields"];
  preview?: OfficeConfirmation["preview"];
  public?: boolean;
  guard?: () => void;
};
type Waiting = {
  sessionId: string;
  root: string;
  call: OfficeCall;
  card: OfficeConfirmation;
  mutation: Mutation;
  finish: (result: Output) => void;
};

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export class OfficeTools {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly deps: Deps) {}

  private session(id: string): SessionRow {
    const session = this.deps.sessions.find(id);
    const root = this.deps.settings().workspaceRoot;
    if (!root || !session || session.incognito || session.archivedAt || !session.running ||
        (session.brainRoot && session.brainRoot !== root))
      throw new Error("Office tools require an active saved conversation in this workspace.");
    return session;
  }

  async request(id: string, body: Output, signal: AbortSignal): Promise<Output> {
    try {
      const session = this.session(id);
      if (body["kind"] === "list") return { tools: officeCatalog };
      if (body["kind"] !== "call" || signal.aborted) throw new Error("Invalid Office tool request.");
      const call = parseOfficeCall(body["name"], body["arguments"]);
      if (call.name === "office_list_workflows") return this.catalog(session);
      if (call.name === "office_open") return this.open(session, call.input);
      const mutation = this.plan(session, call);
      if (session.autonomy === "full-auto" && !mutation.public) return await mutation.run();
      return await this.confirm(id, call, mutation, signal);
    } catch (error) {
      return { error: message(error) };
    }
  }

  list(sessionId: string): OfficeConfirmation[] {
    return [...this.waiting.values()].filter((item) => item.sessionId === sessionId).map(({ card }) => card);
  }

  private confirm(sessionId: string, call: OfficeCall, mutation: Mutation, signal: AbortSignal): Promise<Output> {
    if (signal.aborted) return Promise.resolve({ error: "The conversation ended." });
    if (this.list(sessionId).length >= 12) return Promise.resolve({ error: "Finish existing Office requests first." });
    const id = randomUUID();
    const card = {
      id, title: mutation.title, fields: mutation.fields,
      preview: mutation.preview ?? fieldsPreview(mutation.fields),
    };
    return new Promise((resolve) => {
      const abort = () => finish({ error: "The conversation ended." });
      const finish = (result: Output) => {
        this.waiting.delete(id);
        signal.removeEventListener("abort", abort);
        this.deps.bus.emit("office.confirmation", { sessionId });
        resolve(result);
      };
      this.waiting.set(id, { sessionId, root: this.deps.settings().workspaceRoot, call, mutation, card, finish });
      signal.addEventListener("abort", abort, { once: true });
      this.deps.bus.emit("office.confirmation", { sessionId });
    });
  }

  async answer(sessionId: string, id: string, save: boolean, edits?: Output): Promise<void> {
    const waiting = this.waiting.get(id);
    if (!waiting || waiting.sessionId !== sessionId) throw new Error("This Office request is no longer waiting.");
    if (!save) { waiting.finish({ error: "The owner discarded this request." }); return; }
    const session = this.session(sessionId);
    if (this.deps.settings().workspaceRoot !== waiting.root) throw new Error("The workspace changed.");
    waiting.mutation.guard?.();
    let mutation = waiting.mutation;
    if (edits && Object.keys(edits).length) {
      const allowed = new Set(waiting.card.fields.map((field) => field.key));
      if (Object.keys(edits).some((key) => !allowed.has(key))) throw new Error("That field cannot be edited.");
      const call = parseOfficeCall(waiting.call.name, { ...waiting.call.input, ...edits });
      mutation = this.plan(session, call);
    }
    this.waiting.delete(id);
    this.deps.bus.emit("office.confirmation", { sessionId });
    try {
      waiting.finish(await mutation.run());
    } catch (error) {
      waiting.finish({ error: message(error) });
      throw error;
    }
  }

  private projects(session: SessionRow): Project[] {
    const root = this.deps.settings().workspaceRoot;
    return this.deps.store.state.workspace?.projects.filter((project) =>
      !project.archived && (project.id === session.projectId || !project.vault || !privateNotes(root, project.vault))) ?? [];
  }

  private project(session: SessionRow, id: string | null | undefined, required = false): Project | undefined {
    if (id == null) {
      if (required) throw new Error("Choose a project for this action.");
      return undefined;
    }
    const project = this.projects(session).find((item) => item.id === id);
    if (!project) throw new Error("That project is unavailable in this conversation.");
    return project;
  }

  private catalog(session: SessionRow): Output {
    const projects = this.projects(session).map(({ id, name }) => ({ id, name }));
    const ids = new Set(projects.map((project) => project.id));
    return {
      workflows: workflowsFor(this.deps.store.state.workspace).filter((workflow) => !workflow.projectId || ids.has(workflow.projectId)),
      projects,
      pipelines: this.pipelines(),
    };
  }

  private pipelines() {
    return Object.entries(this.deps.store.state.workspace?.pipelines ?? {}).map(([value, pipeline]) =>
      ({ label: pipeline.name, value }));
  }

  private open(session: SessionRow, input: Extract<OfficeCall, { name: "office_open" }>["input"]): Output {
    const project = input.projectId || input.view === "project" || input.note
      ? this.project(session, input.projectId ?? session.projectId, true) : undefined;
    if (input.taskId) {
      const task = this.deps.tasks.list().find((item) => item.id === input.taskId);
      if (!task) throw new Error("That Board task could not be found.");
      this.project(session, task.projectId, true);
      return this.navigate({ view: "board", params: { task: task.id } }, `Opened ${task.title}.`);
    }
    if (input.note && project) {
      const note = readNote(this.deps.store.state.workspace, this.deps.settings().workspaceRoot, project.id, input.note);
      if (!note.exists) throw new Error("That project note could not be found.");
      return this.navigate({ view: "project", params: { id: project.id, tab: "notes", note: note.name } }, `Opened ${note.name}.`);
    }
    const params = project ? { [input.view === "project" ? "id" : "project"]: project.id } : undefined;
    return this.navigate({ view: input.view, ...(params ? { params } : {}) }, "Opened in Office.");
  }

  private navigate(link: NotificationLink, description: string): Output {
    this.deps.bus.emit("app.navigate", link);
    return { message: description, link };
  }

  private workflow(session: SessionRow, id: string): WorkflowDefinition {
    const found = workflowsFor(this.deps.store.state.workspace).find((item) => item.id === id);
    if (!found) throw new Error("That workflow could not be found.");
    this.project(session, found.projectId);
    return found;
  }

  private workflowPlan(session: SessionRow, call: Extract<OfficeCall, {
    name: "office_create_workflow" | "office_update_workflow" | "office_run_workflow"
  }>): Mutation {
    if (call.name === "office_run_workflow") {
      const workflow = this.workflow(session, call.input.id);
      if (!workflow.enabled) throw new Error("Enable this workflow before running it.");
      const guard = () => this.checkWorkflow(session, workflow);
      return {
        title: "Run workflow now", fields: [], guard,
        preview: workflowPreview(workflow, this.project(session, workflow.projectId)?.name),
        run: async () => {
          const runId = await this.deps.scheduler.fire(workflow.id);
          return { runId, message: runId ? `Ran ${workflow.name}.` : `${workflow.name} is already running.` };
        },
      };
    }
    const previous = call.name === "office_update_workflow" ? this.workflow(session, call.input.id) : undefined;
    const id = previous?.id ?? slugify(call.input.name ?? "");
    const workflow = Workflow.parse({ ...previous, ...call.input, id });
    const project = this.project(session, workflow.projectId);
    if (!project && ["project", "both"].includes(workflow.read)) throw new Error("Choose a project for the read scope.");
    if (workflow.schedule && !validCron(workflow.schedule)) throw new Error("That schedule is invalid.");
    if (!previous && workflowsFor(this.deps.store.state.workspace).some((item) => item.id === id))
      throw new Error("A workflow with that name already exists.");
    return {
      title: previous ? "Update workflow" : "Create workflow",
      guard: () => {
        if (previous) this.checkWorkflow(session, previous);
        this.project(session, workflow.projectId);
      },
      fields: toolFields(call, this.projects(session), workflow, this.pipelines()),
      preview: workflowPreview(workflow, project?.name),
      run: async () => {
        await this.deps.editor.saveWorkflow(workflow, previous ? { previous } : { absent: true });
        return { message: `Saved ${workflow.name}.`, id };
      },
    };
  }

  private checkWorkflow(session: SessionRow, workflow: WorkflowDefinition): void {
    if (JSON.stringify(this.workflow(session, workflow.id)) !== JSON.stringify(workflow))
      throw new Error("This workflow changed after the preview. Ask for a new preview.");
  }

  private plan(session: SessionRow, call: OfficeCall): Mutation {
    if (call.name === "office_create_workflow" || call.name === "office_update_workflow" || call.name === "office_run_workflow")
      return this.workflowPlan(session, call);
    const { name, input } = call;
    const project = "projectId" in input || name !== "office_create_project"
      ? this.project(session, ("projectId" in input ? input.projectId : undefined) ?? session.projectId,
        ["office_start_session", "office_set_reminder", "office_add_waiting", "office_create_task"].includes(name))
      : undefined;
    const fields = toolFields(call, this.projects(session), { ...input, ...(project ? { projectId: project.id } : {}) }, this.pipelines());
    const guard = () => { this.project(session, project?.id); };
    switch (name) {
      case "office_create_project": {
        const projectInput = { ...input, exploreSessionId: session.id, publicConfirmed: false };
        this.deps.explore.plan(projectInput);
        return {
          title: input.visibility === "public" ? "Create and publish a public project" : "Create project",
          public: input.visibility === "public", fields,
          run: async () => {
            const report = await this.deps.explore.spawn({ ...projectInput, publicConfirmed: input.visibility === "public" });
            if (!report.ok || !report.sessionId) {
              const failed = report.steps.find((step) => step.status === "failed");
              throw new Error(failed?.result ?? "Office could not finish creating the project.");
            }
            return { ...this.navigate({ view: "agents", params: { session: report.sessionId } }, `Created ${input.name}.`), projectId: report.projectId };
          },
        };
      }
      case "office_start_session":
        return { title: "Start session", fields, guard, run: async () => {
          const started = this.deps.sessions.start({
            projectId: project!.id, providerId: session.provider, title: input.goal,
            mode: "chat", ...(input.firstMessage ? { prompt: input.firstMessage } : {}),
          });
          return this.navigate({ view: "agents", params: { session: started.id } }, `Started ${input.goal}.`);
        } };
      case "office_create_task":
        if (!this.pipelines().some((pipeline) => pipeline.value === input.pipeline)) throw new Error("Choose an existing pipeline.");
        return { title: "Create Board task", fields, guard, run: async () => {
          const task = this.deps.tasks.create({ ...input, projectId: project!.id });
          return this.navigate({ view: "board", params: { task: task.id } }, `Created ${task.title}.`);
        } };
      case "office_save_note":
        return { title: "Save Brain note", fields, guard, run: async () => {
          await this.deps.recorder.saveNote(project?.id ?? null, input.text);
          return { message: "Saved the note." };
        } };
      case "office_add_waiting":
        return { title: "Add to Waiting on you", fields, guard, run: async () => {
          await this.deps.ops.addWaiting(project!.id, input.text);
          this.deps.bus.emit("vault.changed", {}, project!.id);
          return { message: "Added the waiting item." };
        } };
      case "office_set_reminder": {
        const date = reminderDate(input.date);
        return { title: "Set reminder", fields, guard, run: async () => {
          await this.deps.ops.addReminder(project!.id, date, input.text);
          this.deps.bus.emit("vault.changed", {}, project!.id);
          return { message: `Set the reminder for ${date}.` };
        } };
      }
      default:
        throw new Error("This action does not change Office.");
    }
  }
}
