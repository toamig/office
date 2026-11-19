import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthView } from "../../src/shared/models";
import { HealthService } from "../../src/main/modules/vault/health-service";

const OK: HealthView["validate"] = {
  ran: true,
  ok: true,
  errors: [],
  warnings: 0,
  summary: "hub: ok",
  problems: [],
  output: "",
};

function setup(kind: string | undefined = "brain-hub") {
  const validate = vi.fn(async () => OK);
  const repos = vi.fn(async () => [] as HealthView["repos"]);
  const changed = vi.fn();
  const service = new HealthService({
    root: () => "/hub",
    kind: () => kind,
    warnings: () => [],
    validate,
    repos,
    onChange: changed,
    now: () => new Date("2026-11-18T10:00:00Z"),
  });
  return { service, validate, repos, changed };
}

describe("HealthService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("answers from memory: reading the view never runs the checks", () => {
    const { service, validate, repos } = setup();
    for (let i = 0; i < 20; i++) service.view();
    expect(validate).not.toHaveBeenCalled();
    expect(repos).not.toHaveBeenCalled();
    expect(service.view().checkedAt).toBeNull();
  });

  it("runs the checks once per refresh and keeps the result with its time", async () => {
    const { service, validate, repos, changed } = setup();
    await service.refresh();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(repos).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) service.view();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(service.view().validate).toEqual(OK);
    expect(service.view().checkedAt).toBe("2026-11-18T10:00:00.000Z");
  });

  it("does not run two checks at once; a request during one runs a single follow-up", async () => {
    const { service, validate } = setup();
    const first = service.refresh();
    void service.refresh();
    void service.refresh();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("checks once things have been quiet, however many changes arrive", async () => {
    const { service, validate } = setup();
    for (let i = 0; i < 10; i++) {
      service.schedule(30_000);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(validate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("checks at start and then on its timer", async () => {
    const { service, validate } = setup();
    service.start(900_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(validate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(validate).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("has nothing to check for a vault that is not a brain hub", async () => {
    const { service, validate } = setup("folder");
    await service.refresh();
    expect(validate).not.toHaveBeenCalled();
    expect(service.view().validate.ran).toBe(false);
    expect(service.view().checkedAt).not.toBeNull();
  });
});
