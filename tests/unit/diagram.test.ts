import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  currentStage,
  PipelineDiagram,
  PipelineMarks,
  type DiagramStage,
} from "../../src/renderer/src/ui/PipelineDiagram";
import { STATUS } from "../../src/shared/tone";

const stage = (id: string, status: string, over: Partial<DiagramStage> = {}): DiagramStage => ({
  id,
  role: id === "plan" ? "planner" : id === "build" ? "builder" : "reviewer",
  provider: id === "review" ? "codex" : "claude-code",
  gate: id !== "build",
  status,
  ...over,
});

const STATES = [
  "pending",
  "running",
  "waiting-gate",
  "waiting-permission",
  "approved",
  "done",
  "failed",
  "skipped",
];

describe("the pipeline diagram", () => {
  it("draws every stage state with its badge word and its own data-status", () => {
    for (const state of STATES) {
      const html = renderToStaticMarkup(
        createElement(PipelineDiagram, {
          stages: [stage("plan", "done"), stage("build", state), stage("review", "pending")],
        }),
      );
      expect(html, state).toContain(`data-status="${state}"`);
      expect(html, state).toContain(`>${STATUS[state]?.label}<`);
      expect(html).toContain("Plan");
      expect(html).toContain("Planner, Claude Code");
      expect(html).toContain("Reviewer, Codex");
    }
  });

  it("puts a You node after every stage the owner approves, and a line after the others", () => {
    const html = renderToStaticMarkup(
      createElement(PipelineDiagram, {
        stages: [stage("plan", "done"), stage("build", "running"), stage("review", "pending")],
      }),
    );
    // Plan and review are gates; build is not, so it is joined by a plain line.
    expect(html.match(/data-testid="diagram-you"/g)).toHaveLength(2);
    expect(html.match(/class="diagram-line"/g)).toHaveLength(1);
  });

  it("emphasises one stage: the working one, else the one waiting, else the first not done", () => {
    expect(
      currentStage([stage("plan", "done"), stage("build", "running"), stage("review", "pending")]),
    ).toBe(1);
    expect(
      currentStage([
        stage("plan", "waiting-gate"),
        stage("build", "pending"),
        stage("review", "pending"),
      ]),
    ).toBe(0);
    expect(
      currentStage([
        stage("plan", "approved"),
        stage("build", "pending"),
        stage("review", "pending"),
      ]),
    ).toBe(1);
    expect(
      currentStage([stage("plan", "done"), stage("build", "done"), stage("review", "done")]),
    ).toBe(2);
    const html = renderToStaticMarkup(
      createElement(PipelineDiagram, {
        stages: [stage("plan", "done"), stage("build", "running"), stage("review", "pending")],
      }),
    );
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html).toContain('data-working="true"');
  });

  it("stacks the builders of a fan-out stage with their count", () => {
    const html = renderToStaticMarkup(
      createElement(PipelineDiagram, {
        stages: [
          stage("plan", "done"),
          stage("build", "running", {
            variants: [
              { n: 1, status: "done" },
              { n: 2, status: "running" },
              { n: 3, status: "failed" },
            ],
          }),
          stage("review", "pending"),
        ],
      }),
    );
    expect(html).toContain("3 builders");
    expect(html).toContain("Builder 1: Done");
    expect(html).toContain("Builder 2: Running");
    expect(html).toContain("Builder 3: Failed");
    // One builder is not a fan-out.
    const single = renderToStaticMarkup(
      createElement(PipelineDiagram, {
        stages: [stage("build", "running", { variants: [{ n: 1, status: "running" }] })],
      }),
    );
    expect(single).not.toContain("builders");
  });

  it("is a row of small marks and the current stage's name with who is on it, when compact", () => {
    const html = renderToStaticMarkup(
      createElement(PipelineMarks, {
        stages: [stage("plan", "done"), stage("build", "done"), stage("review", "waiting-gate")],
      }),
    );
    expect(html.match(/class="mark"/g)).toHaveLength(3);
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html).toContain('data-status="waiting-gate"');
    expect(html).toContain("Review, Reviewer (Codex)");
  });

  it("is never a button when nothing handles a click, and names each stage for a screen reader", () => {
    const html = renderToStaticMarkup(
      createElement(PipelineDiagram, { stages: [stage("plan", "failed")] }),
    );
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Plan: Failed"');
  });
});
