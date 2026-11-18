import { expect, test, type Page } from "@playwright/test";
import { launch } from "./helpers";

/** Every button with no visible text, on the page now, that lacks a label or a tooltip. */
async function unlabelled(win: Page): Promise<string[]> {
  return win.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("button, [role='button']")) {
      const html = el as HTMLElement;
      const rect = html.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (html.innerText ?? "").trim();
      if (text !== "") continue;
      const label = html.getAttribute("aria-label")?.trim();
      const title = html.getAttribute("title")?.trim();
      if (!label || !title) {
        const where = html.closest("[data-testid]")?.getAttribute("data-testid") ?? html.className;
        bad.push(`${where}: label=${label ?? "none"} title=${title ?? "none"}`);
      }
    }
    return bad;
  });
}

test("every icon-only button has an aria-label and a tooltip, in every view", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  await expect(win.getByTestId("topbar")).toBeVisible();
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "A chat",
      mode: "chat",
    }),
  );
  await win.evaluate(() =>
    window.office.invoke("sessions.start", {
      providerId: "fake",
      projectId: "alpha",
      title: "A terminal",
      mode: "terminal",
    }),
  );
  const found: string[] = [];
  const check = async (where: string): Promise<void> => {
    await win.waitForTimeout(400);
    for (const b of await unlabelled(win)) found.push(`${where} > ${b}`);
  };
  for (const view of [
    "home",
    "projects",
    "agents",
    "git",
    "board",
    "brain",
    "inbox",
    "explore",
    "setup",
  ]) {
    await win.getByTestId(`rail-${view}`).click();
    await check(view);
  }
  await win.getByTestId("rail-agents").click();
  await win.getByTestId("session-row").filter({ hasText: "A chat" }).click();
  await check("chat");
  await win.getByTestId("session-row").filter({ hasText: "A terminal" }).click();
  await check("terminal");
  await win.getByTestId("rail-projects").click();
  await win.getByTestId("project-card").first().click();
  await check("project page");
  await win.getByTestId("switcher-button").click();
  await check("quick switcher");
  await win.keyboard.press("Escape");
  await win.keyboard.press("Control+/");
  await check("shortcuts sheet");
  expect(found).toEqual([]);
  await app.close();
});
