import { describe, expect, it } from "vitest";

import { canTransition, transition } from "../src/domain/job-state";

describe("job state machine", () => {
  it("permits the controlled happy path", () => {
    expect(canTransition("draft", "uploaded")).toBe(true);
    expect(transition("validated", "awaiting_submit")).toBe("awaiting_submit");
    expect(transition("storing", "completed")).toBe("completed");
  });

  it("rejects paths that would skip server-owned stages", () => {
    expect(canTransition("draft", "generating")).toBe(false);
    expect(() => transition("uploaded", "completed")).toThrow("Invalid job transition");
  });

  it("allows deletion from a terminal user-visible state", () => {
    expect(transition("completed", "deletion_requested")).toBe("deletion_requested");
    expect(transition("deletion_requested", "deleted")).toBe("deleted");
  });
});
