import { Card } from "../../ui";
import { ToolsStep } from "./ToolsStep";

/** Setup's tools table: the welcome flow's tools step, as a plain panel. */
export function ToolsPanel() {
  return (
    <Card title="Tools" testId="panel-tools">
      <ToolsStep />
    </Card>
  );
}
