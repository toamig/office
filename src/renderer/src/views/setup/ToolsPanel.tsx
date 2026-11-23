import { Card } from "../../ui";
import { ToolsStep } from "./ToolsStep";

/** Setup's agent programs: Claude Code and Codex install and sign-in: the welcome flow's tools step, as a plain panel. */
export function ToolsPanel() {
  return (
    <Card title="Agent programs" testId="panel-tools">
      <ToolsStep staySignedIn />
    </Card>
  );
}
