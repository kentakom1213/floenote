import { createDocumentId } from "@floe-note/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteDocument } from "../src/document.js";

describe("NoteDocument metadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes createdAt, updatedAt, and tags", () => {
    const document = NoteDocument.create(
      createDocumentId(),
      "Welcome",
      1_700_000_000_000,
    );

    expect(document.createdAt).toBe(1_700_000_000_000);
    expect(document.updatedAt).toBe(1_700_000_000_000);
    expect(document.tags).toEqual([]);
  });

  it("preserves metadata in snapshots", () => {
    const id = createDocumentId();
    const document = NoteDocument.create(id, "Welcome", 100);

    vi.spyOn(Date, "now").mockReturnValue(200);
    document.setTags(["floe", "notes"]);

    const restored = NoteDocument.fromSnapshot(id, document.exportSnapshot());

    expect(restored.createdAt).toBe(100);
    expect(restored.updatedAt).toBe(200);
    expect(restored.tags).toEqual(["floe", "notes"]);
  });

  it("returns null for timestamps missing from an older document", () => {
    const document = NoteDocument.empty(createDocumentId());

    expect(document.createdAt).toBeNull();
    expect(document.updatedAt).toBeNull();
    expect(document.tags).toEqual([]);
  });

  it("updates updatedAt when the title changes", () => {
    const document = NoteDocument.create(createDocumentId(), "Old", 100);
    vi.spyOn(Date, "now").mockReturnValue(250);

    document.setTitle("New");

    expect(document.title).toBe("New");
    expect(document.createdAt).toBe(100);
    expect(document.updatedAt).toBe(250);
  });

  it("does not update updatedAt when setting the same title", () => {
    const document = NoteDocument.create(createDocumentId(), "Same", 100);
    vi.spyOn(Date, "now").mockReturnValue(250);

    document.setTitle("Same");

    expect(document.updatedAt).toBe(100);
  });

  it("normalizes tags and prevents exact duplicates", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);
    vi.spyOn(Date, "now").mockReturnValue(250);

    document.setTags(["  research  ", "graph", "research"]);

    expect(document.tags).toEqual(["research", "graph"]);
    expect(document.updatedAt).toBe(250);
  });

  it("rejects empty tags", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);

    expect(() => document.addTag("   ")).toThrow("Tag must not be empty");
    expect(() => document.setTags(["valid", "   "])).toThrow(
      "Tag must not be empty",
    );
    expect(document.tags).toEqual([]);
    expect(document.updatedAt).toBe(100);
  });

  it("adds and removes tags while updating updatedAt", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(200);
    document.addTag("  floe ");
    expect(document.tags).toEqual(["floe"]);
    expect(document.updatedAt).toBe(200);

    now.mockReturnValue(300);
    document.addTag("floe");
    expect(document.tags).toEqual(["floe"]);
    expect(document.updatedAt).toBe(200);

    now.mockReturnValue(400);
    document.removeTag(" floe ");
    expect(document.tags).toEqual([]);
    expect(document.updatedAt).toBe(400);
  });

  it("updates updatedAt after a local body edit", async () => {
    const document = NoteDocument.create(createDocumentId(), "Body", 100);
    vi.spyOn(Date, "now").mockReturnValue(500);
    const binding = document.getEditorBinding();

    binding.getText(binding.doc).insert(0, "Hello");
    binding.doc.commit();
    await Promise.resolve();

    expect(document.bodyText).toBe("Hello");
    expect(document.updatedAt).toBe(500);
  });

  it("includes the body edit and its timestamp in local CRDT updates", async () => {
    const document = NoteDocument.create(createDocumentId(), "Body", 100);
    const replica = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const updates: Uint8Array[] = [];
    document.subscribeLocalUpdates((update) => updates.push(update));
    vi.spyOn(Date, "now").mockReturnValue(500);
    const binding = document.getEditorBinding();

    binding.getText(binding.doc).insert(0, "Hello");
    binding.doc.commit();
    await Promise.resolve();

    expect(updates.length).toBeGreaterThanOrEqual(2);

    for (const update of updates) replica.importUpdate(update);

    expect(replica.bodyText).toBe("Hello");
    expect(replica.updatedAt).toBe(500);
  });

  it("does not synthesize updatedAt when importing a remote update", () => {
    const id = createDocumentId();
    const source = NoteDocument.create(id, "Original", 100);
    const target = NoteDocument.fromSnapshot(id, source.exportSnapshot());
    const targetLocalUpdates: Uint8Array[] = [];
    target.subscribeLocalUpdates((update) => targetLocalUpdates.push(update));

    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(200);
    source.setTitle("Remote title");

    now.mockReturnValue(999);
    target.importUpdate(source.exportUpdate());

    expect(target.title).toBe("Remote title");
    expect(target.updatedAt).toBe(200);
    expect(targetLocalUpdates).toHaveLength(0);
  });

  it("synchronizes tag metadata as CRDT state", () => {
    const id = createDocumentId();
    const source = NoteDocument.create(id, "Tags", 100);
    const target = NoteDocument.fromSnapshot(id, source.exportSnapshot());

    vi.spyOn(Date, "now").mockReturnValue(300);
    source.setTags(["alpha", "beta"]);
    target.importUpdate(source.exportUpdate());

    expect(target.tags).toEqual(["alpha", "beta"]);
    expect(target.updatedAt).toBe(300);
  });
});
