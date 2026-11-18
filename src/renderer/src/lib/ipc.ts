import type { OfficeApi } from "@shared/ipc";
import { isMutation } from "@shared/channel-kinds";

declare global {
  interface Window {
    office: OfficeApi;
  }
}

/** The bridge exactly as the preload exposes it. The query cache reads through this, so a read never counts as a change. */
export const rawOffice: OfficeApi = window.office;

let afterMutation: () => void = () => undefined;

/** The query cache registers itself here, to ask its open queries again after a call that changed something. */
export function onMutation(hook: () => void): void {
  afterMutation = hook;
}

/**
 * The typed bridge to the main process. A call that may have changed data some open view shows (anything that is
 * not a plain read) makes the views read again once it has finished, so no view shows what it showed before.
 */
export const office: OfficeApi = {
  ...rawOffice,
  invoke: (async (channel: string, payload?: unknown) => {
    try {
      return await (rawOffice.invoke as (c: string, p?: unknown) => Promise<unknown>)(
        channel,
        payload,
      );
    } finally {
      if (isMutation(channel)) afterMutation();
    }
  }) as OfficeApi["invoke"],
};
