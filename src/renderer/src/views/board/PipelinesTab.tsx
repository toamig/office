import { Plus } from "lucide-react";
import { useState } from "react";
import type { Pipeline } from "@shared/types";
import { stageName } from "@shared/pipeline-prompt";
import { useQuery } from "../../lib/hooks";
import { PipelineEditor } from "./PipelineEditor";
import { Button, EmptyState, SplitPane } from "../../ui";

/** Pipelines: the stages a task goes through, each with a role, an optional approval and a prompt. */
export function PipelinesTab() {
  const workspace = useQuery("workspace.get", undefined, ["workspace.changed"]);
  const pipelines = workspace.data?.workspace?.pipelines ?? {};
  const ids = Object.keys(pipelines);
  const [selected, setSelected] = useState("");
  const [fresh, setFresh] = useState(false);
  const current = fresh ? undefined : pipelines[selected] ? selected : ids[0];

  const list = (
    <div className="p-2" data-testid="pipeline-list">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="ui-group m-0">Pipelines</h3>
        <Button size="sm" onClick={() => setFresh(true)} data-testid="new-pipeline">
          <Plus /> New pipeline
        </Button>
      </div>
      {ids.length === 0 && (
        <EmptyState title="No pipelines">Make one with New pipeline.</EmptyState>
      )}
      {ids.map((pid) => (
        <div
          key={pid}
          data-testid="pipeline-row"
          className="ui-row"
          role="button"
          tabIndex={0}
          data-clickable="true"
          data-selected={current === pid ? "true" : undefined}
          onClick={() => {
            setFresh(false);
            setSelected(pid);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setFresh(false);
              setSelected(pid);
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">{pipelines[pid]?.name}</div>
            <div className="ui-line-sub">
              {pipelines[pid]?.stages.map((s) => stageName(s)).join(", ")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-0 flex-1" data-testid="pipelines-tab">
      <SplitPane
        id="pipelines"
        defaultSize={320}
        min={240}
        minSecond={520}
        first={list}
        second={
          fresh ? (
            <PipelineEditor
              key="new"
              id=""
              isNew
              pipeline={{ name: "", stages: [] }}
              onSaved={(pid) => {
                setFresh(false);
                setSelected(pid);
              }}
              onDeleted={() => setFresh(false)}
            />
          ) : current && pipelines[current] ? (
            <PipelineEditor
              key={current}
              id={current}
              isNew={false}
              pipeline={pipelines[current] as Pipeline}
              onSaved={setSelected}
              onDeleted={() => setSelected("")}
            />
          ) : (
            <EmptyState title="No pipeline">Pick one on the left.</EmptyState>
          )
        }
      />
    </div>
  );
}
