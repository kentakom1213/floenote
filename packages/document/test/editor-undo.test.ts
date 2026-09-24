import { createDocumentId } from "@floe-note/domain";
import { UndoManager } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";

import { NoteDocument } from "../src/document.js";

function createEditorUndoManager(document: NoteDocument): UndoManager {
  const binding = document.getEditorBinding();
  return new UndoManager(binding.doc, {
    mergeInterval: 0,
    excludeOriginPrefixes: [...binding.undoExcludeOriginPrefixes],
  });
}

async function flushAutomaticTimestamp(): Promise<void> {
  await Promise.resolve();
}

describe("NoteDocument editor undo history", () => {
  it("keeps automatic updatedAt commits out of the body undo stack", async () => {
    const document = NoteDocument.create(createDocumentId(), "Undo", 100);
    const binding = document.getEditorBinding();
    const undoManager = createEditorUndoManager(document);
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(200);
    binding.getText(binding.doc).insert(0, "a");
    binding.doc.commit();
    await flushAutomaticTimestamp();

    now.mockReturnValue(300);
    binding.getText(binding.doc).insert(1, "b");
    binding.doc.commit();
    await flushAutomaticTimestamp();

    expect(document.bodyText).toBe("ab");

    expect(undoManager.undo()).toBe(true);
    await flushAutomaticTimestamp();
    expect(document.bodyText).toBe("a");
    expect(undoManager.canUndo()).toBe(true);
    expect(undoManager.canRedo()).toBe(true);

    expect(undoManager.undo()).toBe(true);
    await flushAutomaticTimestamp();
    expect(document.bodyText).toBe("");
    expect(undoManager.canRedo()).toBe(true);

    expect(undoManager.redo()).toBe(true);
    await flushAutomaticTimestamp();
    expect(document.bodyText).toBe("a");

    expect(undoManager.redo()).toBe(true);
    await flushAutomaticTimestamp();
    expect(document.bodyText).toBe("ab");
  });


  it("groups a complete IME composition into one body undo step", async () => {
    const document = NoteDocument.create(createDocumentId(), "IME", 100);
    const binding = document.getEditorBinding();
    const undoManager = createEditorUndoManager(document);
    const text = binding.getText(binding.doc);
    const now = vi.spyOn(Date, "now");

    const replaceBody = (value: string) => {
      const current = text.toString();
      if (current.length > 0) text.delete(0, current.length);
      if (value.length > 0) text.insert(0, value);
      binding.doc.commit();
    };

    // A regular edit immediately before the composition gets its own
    // timestamp commit, which forms a CRDT counter boundary.
    now.mockReturnValue(200);
    replaceBody("prefix ");
    await flushAutomaticTimestamp();

    now.mockReturnValue(300);
    binding.beginComposition();
    undoManager.groupStart();

    replaceBody("prefix に");
    replaceBody("prefix にほ");
    replaceBody("prefix にほん");
    replaceBody("prefix 日本");

    undoManager.groupEnd();
    binding.endComposition();
    await flushAutomaticTimestamp();

    expect(document.bodyText).toBe("prefix 日本");
    expect(document.updatedAt).toBe(300);

    expect(undoManager.undo()).toBe(true);
    await flushAutomaticTimestamp();
    expect(document.bodyText).toBe("prefix ");

    expect(undoManager.redo()).toBe(true);
    await flushAutomaticTimestamp();
    expect(document.bodyText).toBe("prefix 日本");
  });

  it("does not undo title or tag metadata from the source editor", async () => {
    const document = NoteDocument.create(createDocumentId(), "Original", 100);
    const binding = document.getEditorBinding();
    const undoManager = createEditorUndoManager(document);

    binding.getText(binding.doc).insert(0, "body");
    binding.doc.commit();
    await flushAutomaticTimestamp();

    document.setTitle("Renamed");
    document.setTags(["editor"]);

    expect(undoManager.undo()).toBe(true);
    await flushAutomaticTimestamp();

    expect(document.bodyText).toBe("");
    expect(document.title).toBe("Renamed");
    expect(document.tags).toEqual(["editor"]);
  });
});
