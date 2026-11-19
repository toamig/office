import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanProjectsRoot, suggestRoots } from "../../src/main/modules/setup/projects-folder";

const projects = [
  { id: "alpha", name: "Alpha", path: "Alpha" },
  { id: "beta", name: "Beta", path: "Beta" },
  { id: "gamma", name: "Gamma", path: "sub/Gamma" },
];
const norm = (p: string): string => resolve(p).replaceAll("\\", "/").toLowerCase();
const present = (paths: string[]) => {
  const set = new Set(paths.map(norm));
  return (p: string): boolean => set.has(norm(p));
};

describe("scanProjectsRoot", () => {
  it("names the projects found and the ones missing", () => {
    const scan = scanProjectsRoot(projects, "/p", {}, present(["/p", "/p/Alpha", "/p/sub/Gamma"]));
    expect(scan).toEqual({ total: 3, found: ["Alpha", "Gamma"], missing: ["Beta"] });
  });

  it("finds a project at the path this PC was told for it", () => {
    const scan = scanProjectsRoot(
      projects,
      "/p",
      { beta: "/elsewhere/Beta" },
      present(["/elsewhere/Beta"]),
    );
    expect(scan.found).toEqual(["Beta"]);
  });
});

describe("suggestRoots", () => {
  it("picks the folder where most of the projects are, from the parents of the workspace folder", () => {
    const exists = present([
      "/e",
      "/e/projects",
      "/e/projects/knowledge",
      "/e/projects/knowledge/brain",
      "/e/projects/Alpha",
      "/e/projects/Beta",
      "/e/projects/sub/Gamma",
      "/c/projects",
      "/c/projects/Alpha",
    ]);
    const list = suggestRoots("/e/projects/knowledge/brain", projects, "/home/me", exists);
    expect(list[0]).toMatchObject({ found: 3, total: 3 });
    expect(norm(list[0]?.path ?? "")).toBe(norm("/e/projects"));
  });

  it("offers nothing when no place holds any project", () => {
    expect(suggestRoots("/w/brain", projects, "/home/me", present(["/w", "/w/brain"]))).toEqual([]);
  });
});
