import { describe, expect, it } from "vitest";

import {
  CompositionUndoGroup,
  EDITOR_UNDO_MAX_STEPS,
  runLoroRedo,
  runLoroUndo,
} from "../src/loro-undo.js";

describe("Loro undo commands", () => {
  it("uses a larger editor undo stack", () => {
    expect(EDITOR_UNDO_MAX_STEPS).toBe(500);
  });

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

    expect(runLoroUndo(manager)).toBe(true);
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

    expect(runLoroRedo(manager)).toBe(true);
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

    expect(runLoroUndo(manager)).toBe(true);
    expect(runLoroRedo(manager)).toBe(true);
    expect(mutations).toBe(0);
  });

  it("allows repeated undo commands to consume multiple history entries", () => {
    let remaining = 3;
    let undoCalls = 0;
    const manager = {
      canUndo: () => remaining > 0,
      undo: () => {
        remaining -= 1;
        undoCalls += 1;
      },
      canRedo: () => false,
      redo: () => undefined,
    };

    expect(runLoroUndo(manager)).toBe(true);
    expect(runLoroUndo(manager)).toBe(true);
    expect(runLoroUndo(manager)).toBe(true);
    expect(runLoroUndo(manager)).toBe(true);

    expect(undoCalls).toBe(3);
    expect(remaining).toBe(0);
  });
});

describe("CompositionUndoGroup", () => {
  it("opens once after the first composition change and closes once", () => {
    const events: string[] = [];
    const group = new CompositionUndoGroup(
      {
        groupStart: () => events.push("start"),
        groupEnd: () => events.push("end"),
      },
      {
        beginComposition: () => events.push("begin"),
        endComposition: () => events.push("finish"),
      },
    );

    expect(group.active).toBe(false);

    group.begin();
    group.begin();
    expect(group.active).toBe(true);

    group.end();
    group.end();

    expect(group.active).toBe(false);
    expect(events).toEqual(["begin", "start", "end", "finish"]);
  });
});
