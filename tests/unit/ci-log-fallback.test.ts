import { expect, it, vi } from "vitest";
import { failedRunDetails } from "../../src/main/modules/pending/fix-brief";

it("uses failed GitHub jobs and steps when the run log has expired", async () => {
  const exec = vi.fn()
    .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "HTTP 410: Gone" })
    .mockResolvedValueOnce({ code: 0, stderr: "", stdout: JSON.stringify({ jobs: [
      { name: "Windows", conclusion: "failure", steps: [
        { name: "Checkout", conclusion: "success" }, { name: "Test", conclusion: "failure" },
      ] },
      { name: "Linux", conclusion: "success", steps: [] },
      { name: "Package", conclusion: "timed_out", steps: [] },
    ] }) });
  const details = await failedRunDetails(exec, "12345", "test-repository");
  expect(exec.mock.calls).toEqual([
    ["gh", ["run", "view", "12345", "--log-failed"], "test-repository"],
    ["gh", ["run", "view", "12345", "--json", "jobs"], "test-repository"],
  ]);
  expect(details).toEqual({
    step: "Windows / Test",
    text: "GitHub no longer has this run's log\n- Windows / Test\n- Package",
  });
});

it("still returns the missing-log explanation when GitHub cannot list jobs", async () => {
  const exec = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "Offline" });
  expect(await failedRunDetails(exec, "12345", "test-repository")).toEqual({
    step: null, text: "GitHub no longer has this run's log",
  });
});
