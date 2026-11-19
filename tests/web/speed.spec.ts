import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../src/main/core/db";
import { allowSeveralSessions, launch } from "./helpers";

/** Each view's root element, and the rail button that opens it. */
const VIEWS = [
  ["home", "home"],
  ["projects", "projects"],
  ["agents", "agents"],
  ["git", "git"],
  ["board", "board"],
  ["brain", "brain"],
  ["inbox", "inbox"],
  ["explore", "explore"],
  ["setup", "setup"],
] as const;

/** Clicks a view's rail button, waits 150 ms, and reports what the view shows by then. */
async function revisit(win: Page, rail: string, root: string) {
  return win.evaluate(
    ({ rail, root }) =>
      new Promise<{ present: boolean; text: number; placeholder: boolean }>((resolve) => {
        (document.querySelector(`[data-testid="rail-${rail}"]`) as HTMLElement).click();
        setTimeout(() => {
          const el = document.querySelector(`[data-testid="${root}"]`) as HTMLElement | null;
          const text = el?.innerText ?? "";
          resolve({
            present: el !== null && el.offsetParent !== null,
            text: text.length,
            placeholder: /\bLoading\b|Checking tools|Checking for updates/i.test(text),
          });
        }, 150);
      }),
    { rail, root },
  );
}

test("a view opened before shows its content within 150 ms, with no loading placeholder", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("home")).toBeVisible();

  // A running agent and a chat, so the views have something to show.
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Level work",
    }),
  );
  await win.evaluate(() =>
    window.office.invoke("tasks.create", {
      projectId: "alpha",
      pipeline: "feature",
      title: "Add a sheep counter",
      description: "Plan it.",
      fanout: 1,
    }),
  );

  // First pass: open every view and let it settle; remember how much each shows.
  const settled = new Map<string, number>();
  for (const [rail, root] of VIEWS) {
    await win.getByTestId(`rail-${rail}`).click();
    await expect(win.getByTestId(root)).toBeVisible();
    await win.waitForTimeout(600);
    settled.set(
      rail,
      await win.getByTestId(root).evaluate((el) => (el as HTMLElement).innerText.length),
    );
  }

  // Second pass: every view again. The content is there within 150 ms, whole, with no placeholder.
  for (const [rail, root] of VIEWS) {
    const seen = await revisit(win, rail, root);
    expect(seen.present, `${rail} is on screen`).toBe(true);
    expect(seen.placeholder, `${rail} has no loading placeholder`).toBe(false);
    expect(seen.text, `${rail} shows what it showed before`).toBeGreaterThanOrEqual(
      Math.floor((settled.get(rail) ?? 0) * 0.8),
    );
    await win.waitForTimeout(200);
  }
  await app.close();
});

test("switching views keeps a running terminal's scrollback and a streaming chat, with no reload", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("home")).toBeVisible();
  await allowSeveralSessions(win);
  const terminal = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Terminal one",
      mode: "terminal",
    }),
  );
  const chat = await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "Chat one",
      mode: "chat",
    }),
  );

  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "Terminal one" }).click();
  await expect(win.getByTestId("terminal")).toBeVisible();
  await expect
    .poll(() =>
      win.evaluate(() => {
        const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
          __term?: {
            buffer: {
              active: {
                length: number;
                getLine: (i: number) => { translateToString: (t: boolean) => string } | undefined;
              };
            };
          };
        };
        const b = host.__term?.buffer.active;
        if (!b) return "";
        let out = "";
        for (let i = 0; i < b.length; i++)
          out += `${b.getLine(i)?.translateToString(true) ?? ""}\n`;
        return out;
      }),
    )
    .toContain("fake-claude ready");
  void terminal;

  // A chat that is streaming while the owner is away.
  await win.getByTestId("session-row").filter({ hasText: "Chat one" }).click();
  // Both side by side, so both are on screen and can be marked.
  await win.getByTestId("dock-split-right").first().click();
  await expect(win.getByTestId("chat")).toBeVisible();
  await expect(win.getByTestId("terminal")).toBeVisible();
  // Mark the live objects: if the view were rebuilt, the marks would be gone.
  await win.evaluate(() => {
    type Marked = HTMLElement & { __mark?: string };
    (document.querySelector('[data-testid="chat"]') as Marked).__mark = "same-chat";
    (document.querySelector('[data-testid="terminal"]') as Marked).__mark = "same-terminal";
  });
  await win.getByTestId("composer-input").fill("THINK READ src/a.ts");
  await win.getByTestId("composer-input").press("Enter");
  void chat;

  // Away to Home and other views, then back.
  await win.getByTestId("rail-home").click();
  await expect(win.getByTestId("home")).toBeVisible();
  await expect(win.getByTestId("agents")).toBeHidden();
  await win.getByTestId("rail-projects").click();
  await win.waitForTimeout(1500);
  await win.getByTestId("rail-agents").click();
  await expect(win.getByTestId("agents")).toBeVisible();

  await expect(win.getByTestId("chat")).toContainText("echo: THINK READ src/a.ts", {
    timeout: 30000,
  });
  expect(
    await win.evaluate(
      () =>
        (document.querySelector('[data-testid="chat"]') as HTMLElement & { __mark?: string })
          .__mark,
    ),
  ).toBe("same-chat");

  await expect(win.getByTestId("terminal")).toBeVisible();
  expect(
    await win.evaluate(
      () =>
        (document.querySelector('[data-testid="terminal"]') as HTMLElement & { __mark?: string })
          .__mark,
    ),
  ).toBe("same-terminal");
  await expect
    .poll(() =>
      win.evaluate(() => {
        const host = document.querySelector('[data-testid="terminal"]') as HTMLElement & {
          __term?: {
            buffer: {
              active: {
                length: number;
                getLine: (i: number) => { translateToString: (t: boolean) => string } | undefined;
              };
            };
          };
        };
        const b = host.__term?.buffer.active;
        return b?.getLine(0)?.translateToString(true) ?? "";
      }),
    )
    .toContain("fake-claude ready");
  await app.close();
});

test("a long Needs you list draws only the rows near the screen", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const { base, world } = first;
  if (!world) throw new Error("no world");
  await first.app.firstWindow();
  await first.app.close();

  // 400 things waiting on the owner, written into a project's notes between two runs.
  const file = join(world.hub, "Alpha", "OpenItems.md");
  const lines = Array.from(
    { length: 400 },
    (_, i) =>
      `- [ ] 2026-11-${String(1 + (i % 28)).padStart(2, "0")} Row ${String(i).padStart(3, "0")}`,
  ).join("\n");
  const text = readFileSync(file, "utf8").replace(
    "## Waiting on you\n",
    `## Waiting on you\n\n${lines}\n`,
  );
  writeFileSync(file, text);

  const second = await launch({ base, fakeTools: true });
  const win = await second.app.firstWindow();
  await win.getByTestId("rail-inbox").click();
  const rows = win.getByTestId("pending-item");
  await expect(rows.first()).toBeVisible();
  const drawn = await rows.count();
  expect(drawn).toBeGreaterThan(5);
  expect(drawn).toBeLessThan(120);
  // Scrolling to the end brings the oldest rows into the page, and the rows at the top are no longer drawn.
  const top = await rows.first().innerText();
  await expect
    .poll(async () => {
      await rows.last().scrollIntoViewIfNeeded();
      return (await rows.first().innerText()) === top;
    })
    .toBe(false);
  expect(await rows.count()).toBeLessThan(120);
  await second.app.close();
});

test("a long diff draws only the rows near the screen", async () => {
  const { app, page: win, world } = await launch({ world: true, fakeTools: true });
  const alpha = world?.code["alpha"];
  if (!alpha) throw new Error("no alpha");
  // 700 changed lines in the Alpha repo.
  writeFileSync(
    join(alpha.work, "README.md"),
    `${Array.from({ length: 700 }, (_, i) => `line ${i}`).join("\n")}\n`,
  );
  await win.getByTestId("rail-git").click();
  await win.getByTestId("git-repo").filter({ hasText: "Alpha" }).click();
  await win.getByTestId("git-tab-changes").click();
  await expect(win.getByTestId("diff-file")).toHaveCount(1);
  await expect(win.getByTestId("diff-line").first()).toBeVisible();
  const lines = await win.getByTestId("diff-line").count();
  expect(lines).toBeGreaterThan(5);
  expect(lines).toBeLessThan(250);
  await expect
    .poll(async () => {
      // Whatever scrolls the list (the page, or a dock panel) goes to its end.
      await win
        .getByTestId("diff-line")
        .last()
        .evaluate((el) => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const oy = getComputedStyle(p).overflowY;
            if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight)
              p.scrollTop = p.scrollHeight;
          }
        });
      return win.getByTestId("diff-line").last().innerText();
    })
    .toContain("line 699");
  await app.close();
});

test("a board of 200 task cards answers a click inside one frame", async () => {
  const first = await launch({ world: true, fakeTools: true });
  const { base } = first;
  await first.app.firstWindow();
  await first.app.close();

  // 200 tasks of the Feature pipeline in every state, written to the app's database between two runs.
  const db = openDb(join(base, "data", "office.db"));
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, project_id, pipeline, title, description, branch, worktree, stage_index, status, created_at, updated_at)
     VALUES (?, 'alpha', 'feature', ?, '', NULL, NULL, ?, ?, ?, ?)`,
  );
  const insertStage = db.prepare(
    `INSERT INTO task_stages (task_id, idx, stage_id, role, status) VALUES (?, ?, ?, ?, ?)`,
  );
  const shapes: Array<[string, number, string[]]> = [
    ["running", 0, ["running", "pending", "pending"]],
    ["waiting-gate", 0, ["waiting-gate", "pending", "pending"]],
    ["running", 1, ["approved", "running", "pending"]],
    ["waiting-gate", 2, ["approved", "done", "waiting-gate"]],
    ["done", 2, ["approved", "done", "approved"]],
    ["failed", 1, ["approved", "failed", "pending"]],
  ];
  const roles = ["planner", "builder", "reviewer"];
  const ids = ["plan", "build", "review"];
  const now = Date.now();
  db.transaction(() => {
    for (let i = 0; i < 200; i++) {
      const id = randomUUID();
      const [status, index, stages] = shapes[i % shapes.length] as [string, number, string[]];
      const at = new Date(now - i * 60_000).toISOString();
      insertTask.run(id, `Task ${String(i).padStart(3, "0")}`, index, status, at, at);
      stages.forEach((st, n) => insertStage.run(id, n, ids[n], roles[n], st));
    }
  })();
  db.close();

  const second = await launch({ base, fakeTools: true });
  const win = await second.app.firstWindow();
  await win.getByTestId("rail-board").click();
  await expect(win.getByTestId("task-card")).toHaveCount(200, { timeout: 30000 });
  // Each card has its compact diagram, and every state is in a column.
  await expect(win.getByTestId("task-card").first().locator(".mark")).toHaveCount(3);
  const times = await win.evaluate(async () => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="task-card"] [role="button"]'),
    ];
    const out: number[] = [];
    for (let i = 0; i < 40; i++) {
      const el = cards[(i * 5) % cards.length] as HTMLElement;
      const t0 = performance.now();
      el.click();
      out.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 20));
    }
    return out;
  });
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  expect(p95, `a click took ${p95.toFixed(1)} ms at the 95th percentile`).toBeLessThan(16);
  await second.app.close();
});
