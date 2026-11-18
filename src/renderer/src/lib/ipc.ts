import type { OfficeApi } from "@shared/ipc";

declare global {
  interface Window {
    office: OfficeApi;
  }
}

/** The typed bridge to the main process. */
export const office: OfficeApi = window.office;
