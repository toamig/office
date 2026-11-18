import { BrowserWindow, shell, WebContentsView } from "electron";
import type { PreviewBounds, PreviewState } from "../shared/models";
import { checkPreviewUrl } from "./core/dev-server";
import { isE2E } from "./e2e";

export type PreviewAction = "back" | "forward" | "reload" | "stop" | "external" | "close";

const EMPTY: PreviewState = {
  open: false,
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  error: null,
};

/** A browser pane inside the main window, for the page or local dev server of a project. */
export class PreviewPane {
  private view: WebContentsView | null = null;
  private bounds: PreviewBounds = { x: 0, y: 0, width: 0, height: 0, visible: false };
  private error: string | null = null;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly onState: (state: PreviewState) => void,
  ) {}

  state(): PreviewState {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return EMPTY;
    return {
      open: true,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
      error: this.error,
    };
  }

  private emit(): void {
    this.onState(this.state());
  }

  private ensureView(): WebContentsView | null {
    if (this.view) return this.view;
    const win = this.window();
    if (!win) return null;
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        ...(isE2E() ? { backgroundThrottling: false } : {}),
      },
    });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    wc.on("did-navigate", () => this.emit());
    wc.on("did-navigate-in-page", () => this.emit());
    wc.on("page-title-updated", () => this.emit());
    wc.on("did-start-loading", () => this.emit());
    wc.on("did-stop-loading", () => this.emit());
    wc.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        this.error = `${description} (${code})`;
        this.emit();
      }
    });
    win.contentView.addChildView(view);
    this.view = view;
    this.apply();
    return view;
  }

  /** Positions the pane over the placeholder the renderer measured. */
  setBounds(bounds: PreviewBounds): void {
    this.bounds = bounds;
    this.apply();
  }

  private apply(): void {
    if (!this.view) return;
    const { x, y, width, height, visible } = this.bounds;
    this.view.setVisible(visible);
    this.view.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
    });
  }

  async open(rawUrl: string): Promise<PreviewState> {
    const url = checkPreviewUrl(rawUrl);
    const view = this.ensureView();
    if (!view) throw new Error("There is no window to show the preview in");
    this.error = null;
    try {
      await view.webContents.loadURL(url);
    } catch (err) {
      // did-fail-load already recorded the reason; an aborted or redirected load is not a failure here.
      if (!this.error) this.error = (err as Error).message;
    }
    this.emit();
    return this.state();
  }

  act(action: PreviewAction): PreviewState {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return EMPTY;
    if (action === "back") wc.navigationHistory.goBack();
    else if (action === "forward") wc.navigationHistory.goForward();
    else if (action === "reload") wc.reload();
    else if (action === "stop") wc.stop();
    else if (action === "external") {
      const url = wc.getURL();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    } else if (action === "close") this.destroy();
    return this.state();
  }

  destroy(): void {
    const view = this.view;
    this.view = null;
    if (!view) return;
    try {
      this.window()?.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    } catch {
      /* the window may already be closing */
    }
    this.onState(EMPTY);
  }
}
