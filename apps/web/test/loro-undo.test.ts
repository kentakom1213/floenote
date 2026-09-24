import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  classifyEditorUndoEvent,
  EDITOR_UNDO_MAX_STEPS,
  EDITOR_UNDO_MERGE_INTERVAL_MS,
  runLoroRedo,
  runLoroUndo,
} from "../src/loro-undo.js";

describe("Loro undo commands", () => {
  it("uses an explicit semantic undo configuration", () => {
    expect(EDITOR_UNDO_MAX_STEPS).toBe(500);
    expect(EDITOR_UNDO_MERGE_INTERVAL_MS).toBe(0);
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

describe("CodeMirror undo event classification", () => {
  const state = EditorState.create({ doc: "abc" });

  it("groups ordinary typing separately from IME composition", () => {
    const typing = state.update({
      changes: { from: 3, insert: "d" },
      userEvent: "input.type",
    });
    const composition = state.update({
      changes: { from: 3, insert: "に" },
      userEvent: "input.type.compose.start",
    });

    expect(classifyEditorUndoEvent([typing])).toBe("typing");
    expect(classifyEditorUndoEvent([composition])).toBe("composition");
  });

  it("treats consecutive delete commands as their own group kind", () => {
    const deletion = state.update({
      changes: { from: 2, to: 3 },
      userEvent: "delete.backward",
    });

    expect(classifyEditorUndoEvent([deletion])).toBe("deleting");
  });

  it("treats Enter and paste as atomic undo actions", () => {
    const enter = state.update({
      changes: { from: 3, insert: "\n" },
      userEvent: "input",
    });
    const paste = state.update({
      changes: { from: 3, insert: "pasted" },
      userEvent: "input.paste",
    });

    expect(classifyEditorUndoEvent([enter])).toBe("atomic");
    expect(classifyEditorUndoEvent([paste])).toBe("atomic");
  });

  it("uses explicit selection changes as undo-group boundaries", () => {
    const selection = state.update({
      selection: { anchor: 1 },
      userEvent: "select",
    });

    expect(classifyEditorUndoEvent([selection])).toBe("selection");
    expect(classifyEditorUndoEvent([state.update({})])).toBe("none");
  });
});
