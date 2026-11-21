import type { RequestResult } from "@shared/models";
import { useUi, type ViewId } from "../stores/ui";
import { office } from "./ipc";

export function sendRequest(request: string): Promise<RequestResult> {
  const { view, params } = useUi.getState();
  const projectId = view === "project" ? params["id"] : params["project"];
  return office.invoke("requests.route", { request, ...(projectId ? { projectId } : {}) });
}

export function openRequest(result: RequestResult): void {
  useUi.getState().navigate(result.link.view as ViewId, result.link.params ?? {});
}
