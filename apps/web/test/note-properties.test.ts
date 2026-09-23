import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NoteProperties,
  addTagFromInput,
  formatNoteTimestamp,
  getNoteMetadataSnapshot,
  removeTagFromProperties,
} from "../src/NoteProperties.js";

describe("NoteProperties", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders createdAt and updatedAt", () => {
    const timestamp = Date.UTC(2026, 8, 23, 12, 14);
    const document = NoteDocument.create(
      createDocumentId(),
      "Metadata",
      timestamp,
    );

    const markup = renderToStaticMarkup(
      createElement(NoteProperties, { document }),
    );

    expect(markup).toContain("Created");
    expect(markup).toContain("Updated");
    expect(markup).toContain("2026");
    expect(markup).toContain(new Date(timestamp).toISOString());
  });

  it("formats timestamps as compact local date/time strings", () => {
    const timestamp = Date.UTC(2026, 8, 23, 12, 14);

    expect(formatNoteTimestamp(timestamp, "en-US")).toMatch(
      /Sep 23, 2026.*12:14 PM/u,
    );
    expect(formatNoteTimestamp(null, "en-US")).toBe("Unavailable");
  });

  it("adds a tag through the properties interaction", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);

    expect(addTagFromInput(document, "research")).toBe("added");
    expect(document.tags).toEqual(["research"]);
  });

  it("trims whitespace before adding a tag", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);

    expect(addTagFromInput(document, "  graph-theory  ")).toBe("added");
    expect(document.tags).toEqual(["graph-theory"]);
  });

  it("does not add an empty tag", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);
    vi.spyOn(Date, "now").mockReturnValue(500);

    expect(addTagFromInput(document, "   ")).toBe("empty");
    expect(document.tags).toEqual([]);
    expect(document.updatedAt).toBe(100);
  });

  it("does not add an exact duplicate tag", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);
    const now = vi.spyOn(Date, "now");

    now.mockReturnValue(200);
    expect(addTagFromInput(document, "research")).toBe("added");

    now.mockReturnValue(500);
    expect(addTagFromInput(document, " research ")).toBe("duplicate");
    expect(document.tags).toEqual(["research"]);
    expect(document.updatedAt).toBe(200);
  });

  it("removes a tag through the properties interaction", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);
    document.setTags(["research", "graph-theory"]);

    removeTagFromProperties(document, "research");

    expect(document.tags).toEqual(["graph-theory"]);
  });

  it("reflects remote CRDT metadata updates in the external-store snapshot", () => {
    const id = createDocumentId();
    const source = NoteDocument.create(id, "Remote", 100);
    const target = NoteDocument.fromSnapshot(id, source.exportSnapshot());
    const before = getNoteMetadataSnapshot(target);

    vi.spyOn(Date, "now").mockReturnValue(300);
    source.addTag("synced");
    target.importUpdate(source.exportUpdate());

    expect(getNoteMetadataSnapshot(target)).not.toBe(before);
    expect(target.tags).toEqual(["synced"]);

    const markup = renderToStaticMarkup(
      createElement(NoteProperties, { document: target }),
    );
    expect(markup).toContain("synced");
  });

  it("uses NoteDocument semantics without rewriting metadata itself", () => {
    const document = NoteDocument.create(createDocumentId(), "Stable", 100);
    const originalBody = document.bodyText;
    vi.spyOn(Date, "now").mockReturnValue(250);

    addTagFromInput(document, "metadata");

    expect(document.createdAt).toBe(100);
    expect(document.updatedAt).toBe(250);
    expect(document.title).toBe("Stable");
    expect(document.bodyText).toBe(originalBody);
  });

  it("does not regress title or editor body mutations", async () => {
    const document = NoteDocument.create(createDocumentId(), "Before", 100);
    vi.spyOn(Date, "now").mockReturnValue(400);

    addTagFromInput(document, "tag");
    document.setTitle("After");

    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "Body text");
    binding.doc.commit();
    await Promise.resolve();

    expect(document.title).toBe("After");
    expect(document.bodyText).toBe("Body text");
    expect(document.tags).toEqual(["tag"]);
    expect(document.updatedAt).toBe(400);
  });
});
