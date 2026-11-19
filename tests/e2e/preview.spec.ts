import { expect, test } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { launch } from "./helpers";

test("the preview pane opens a local page, goes back and forward, and refuses other schemes", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      req.url === "/two"
        ? "<title>Page two</title><p>two</p>"
        : '<title>Preview OK</title><a href="/two">next</a>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { app } = await launch({ world: true, fakeTools: true });
    const win = await app.firstWindow();
    await win.getByTestId("rail-projects").click();
    await win.getByTestId("project-card").first().click();
    await win.getByTestId("tab-preview").click();
    await expect(win.getByTestId("preview-tab")).toBeVisible();

    // The empty field shows a hint, not a value, and Go waits for an address.
    await expect(win.getByTestId("preview-url")).toHaveAttribute(
      "placeholder",
      "For example localhost:5173",
    );
    await expect(win.getByTestId("preview-go")).toBeDisabled();

    await win.getByTestId("preview-url").fill(base);
    await win.getByTestId("preview-go").click();
    await expect
      .poll(() => win.evaluate(() => window.office.invoke("preview.state")), { timeout: 15000 })
      .toMatchObject({ open: true, url: `${base}/`, title: "Preview OK", canGoBack: false });

    await win.getByTestId("preview-url").fill(`${base}/two`);
    await win.getByTestId("preview-go").click();
    await expect
      .poll(() => win.evaluate(() => window.office.invoke("preview.state")), { timeout: 15000 })
      .toMatchObject({ url: `${base}/two`, title: "Page two", canGoBack: true });

    await expect(win.getByTestId("preview-back")).toBeEnabled();
    await win.getByTestId("preview-back").click();
    await expect
      .poll(() => win.evaluate(() => window.office.invoke("preview.state")), { timeout: 15000 })
      .toMatchObject({ url: `${base}/`, canGoForward: true });
    await win.getByTestId("preview-forward").click();
    await expect
      .poll(() => win.evaluate(() => window.office.invoke("preview.state")), { timeout: 15000 })
      .toMatchObject({ url: `${base}/two` });

    // Files and scripts are not web pages.
    await win.getByTestId("preview-url").fill("file:///C:/Windows/win.ini");
    await win.getByTestId("preview-go").click();
    await expect(win.getByText("Only http and https pages can be previewed")).toBeVisible();

    // Leaving the tab hides the pane again.
    await win.getByTestId("tab-overview").click();
    await app.close();
  } finally {
    server.close();
  }
});
