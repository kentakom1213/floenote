import { describe, expect, it } from "vitest";

import { runLoroRedo, runLoroUndo } from "../src/loro-undo.js";

describe("Loro undo commands", () => {
  it("runs undo synchronously when available", () => {
    const events: string[] = [];
    const manager = {
      canUndo: () => true,
      undo: () => {
        events.push("undo");
      },
      canRedo: () => false,
      redo: () => undefined,
    };

    expect(runLoroUndo(manager as never)).toBe(true);
    expect(events).toEqual(["undo"]);
  });

  it("runs redo synchronously when available", () => {
    const events: string[] = [];
    const manager = {
      canUndo: () => false,
      undo: () => undefined,
      canRedo: () => true,
      redo: () => {
        events.push("redo");
      },
    };

    expect(runLoroRedo(manager as never)).toBe(true);
    expect(events).toEqual(["redo"]);
  });

  it("consumes undo and redo when Loro has no history", () => {
    let mutations = 0;
    const manager = {
      canUndo: () => false,
      undo: () => {
        mutations += 1;
      },
      canRedo: () => false,
      redo: () => {
        mutations += 1;
      },
    };

    expect(runLoroUndo(manager as never)).toBe(true);
    expect(runLoroRedo(manager as never)).toBe(true);
    expect(mutations).toBe(0);
  });
});
