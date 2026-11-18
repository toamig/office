/**
 * Whether the app window may navigate to `url`: only its own page. In a packaged build that is a file
 * under the app; in development it is exactly the dev server's origin (so `localhost.example.com`,
 * which merely starts with the same text, is refused).
 */
export function isAllowedNavigation(url: string, devServerUrl: string | undefined): boolean {
  if (url.startsWith("file://")) return !devServerUrl;
  if (!devServerUrl) return false;
  try {
    return new URL(url).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/**
 * The CSP header belongs to the app window only. Previewed sites load in their own WebContentsView, which
 * shares the default session, so the header is matched by the id of the page that made the request.
 */
export const isAppRequest = (
  requestWebContentsId: number | undefined,
  appWebContentsId: number,
): boolean => requestWebContentsId === appWebContentsId;
