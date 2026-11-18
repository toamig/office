import { expect, test } from "@playwright/test";
import { launch } from "./helpers";

const create = (command: string, title: string) => ({
  projectId: "alpha",
  pipeline: "perm",
  title,
  description: command,
  fanout: 1,
});

test("a builder asking to run something unlisted waits in the Inbox, and Deny ends the stage with the reason", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const task = await win.evaluate(
    (input) => window.office.invoke("tasks.create", input),
    create("rm -rf build", "Needs a yes"),
  );

  await win.getByTestId("rail-inbox").click();
  const request = win.getByTestId("permission-request");
  await expect(request).toContainText("Needs a yes", { timeout: 60000 });
  await expect(request.getByTestId("permission-summary")).toHaveText("rm -rf build");
  // The task shows as waiting on the owner while the question is open.
  const status = async (): Promise<string | undefined> =>
    (await win.evaluate(() => window.office.invoke("tasks.list", {}))).find((t) => t.id === task.id)
      ?.status;
  await expect.poll(status).toBe("waiting-permission");
  await expect(win.getByTestId("notification").filter({ hasText: "wants to run" })).toBeVisible();

  await request.getByTestId("permission-reason").fill("not in this project");
  await request.getByTestId("permission-deny").click();
  await expect(win.getByTestId("permission-request")).toHaveCount(0);
  await expect.poll(status, { timeout: 60000 }).toBe("done");
  const detail = await win.evaluate((id) => window.office.invoke("tasks.get", { id }), task.id);
  expect(detail.outputs["run"]).toContain("Could not run rm -rf build");
  expect(detail.outputs["run"]).toContain("The owner declined: not in this project");
  await app.close();
});

test("Allow lets the stage finish, and a listed command never asks", async () => {
  const { app } = await launch({ world: true, fakeTools: true });
  const win = await app.firstWindow();
  const listed = await win.evaluate(
    (input) => window.office.invoke("tasks.create", input),
    create("npm test --silent", "Listed command"),
  );
  const outputOf = async (id: string): Promise<string> =>
    (await win.evaluate((i) => window.office.invoke("tasks.get", { id: i }), id)).outputs["run"] ??
    "";
  await expect
    .poll(() => outputOf(listed.id), { timeout: 60000 })
    .toContain("Ran npm test --silent");
  expect(await win.evaluate(() => window.office.invoke("permissions.list"))).toHaveLength(0);

  const task = await win.evaluate(
    (input) => window.office.invoke("tasks.create", input),
    create("make release", "Allowed once"),
  );
  // Home lists the question too, with the same buttons.
  await expect(win.getByTestId("permission-request")).toContainText("Allowed once", {
    timeout: 60000,
  });
  await win.getByTestId("permission-allow").click();
  await expect
    .poll(() => outputOf(task.id), { timeout: 60000 })
    .toContain("after the owner allowed it");
  await app.close();
});
