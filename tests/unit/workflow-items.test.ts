import { describe, expect, it } from "vitest";
import { parseWorkflowItems } from "../../src/main/modules/runs/workflow-items";

const projects = new Set(["alpha", "beta"]);
const item = {
  title: "Share release checklist",
  why: "Both projects ship the same way.\nA shared checklist would save time.",
  projectIds: ["alpha", "beta"],
  sources: ["Projects/Alpha/OpenItems.md", "https://example.invalid/checklist"],
  firstStep: "Compare the existing checklists.",
};

describe("Worth a look item shape", () => {
  it("accepts complete items, fenced JSON, and an explicit empty result", () => {
    const json = JSON.stringify({ items: [item] });
    expect(parseWorkflowItems(json, projects)).toEqual([item]);
    expect(parseWorkflowItems(`\`\`\`json\n${json}\n\`\`\``, projects)).toEqual([item]);
    expect(parseWorkflowItems('{"items":[]}', projects)).toEqual([]);
  });

  it("rejects prose, legacy ideas, empty sources and missing first steps", () => {
    expect(parseWorkflowItems("An idea in prose", projects)).toBeNull();
    expect(parseWorkflowItems('{"ideas":[{"title":"An idea"}]}', projects)).toBeNull();
    expect(parseWorkflowItems(JSON.stringify({ items: [{ ...item, firstStep: undefined }] }), projects)).toBeNull();
    expect(parseWorkflowItems(JSON.stringify({ items: [{ ...item, sources: [] }] }), projects)).toBeNull();
  });

  it("rejects too many items, unknown projects and explanations longer than two lines", () => {
    expect(parseWorkflowItems(JSON.stringify({ items: Array(6).fill(item) }), projects)).toBeNull();
    expect(parseWorkflowItems(JSON.stringify({ items: [{ ...item, projectIds: ["unknown"] }] }), projects)).toBeNull();
    expect(parseWorkflowItems(JSON.stringify({ items: [{ ...item, why: "One\nTwo\nThree" }] }), projects)).toBeNull();
  });
});
