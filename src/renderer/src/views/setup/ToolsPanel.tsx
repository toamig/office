import { Panel } from "../../components/ui";
import { ToolsStep } from "./ToolsStep";

/** Setup's tools table: the welcome flow's tools step, as a plain panel. */
export function ToolsPanel() {
  return (
    <Panel title="Tools">
      <ToolsStep />
    </Panel>
  );
}
