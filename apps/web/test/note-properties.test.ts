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
  getTagAssignmentOptions,
  getTagInputCommand,
  moveTagOptionIndex,
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

  it("keeps timestamps visible without a disclosure control", () => {
    const document = NoteDocument.create(
      createDocumentId(),
      "Metadata",
      Date.UTC(2026, 8, 23, 12, 14),
    );

    const markup = renderToStaticMarkup(
      createElement(NoteProperties, { document }),
    );

    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(markup).not.toContain(">Properties<");
    expect(markup).toContain("Created");
    expect(markup).toContain("Updated");
  });

  it("renders a trailing control beside the metadata footer", () => {
    const document = NoteDocument.create(createDocumentId(), "Metadata", 100);
    const markup = renderToStaticMarkup(
      createElement(NoteProperties, {
        document,
        trailingControl: createElement(
          "span",
          { "data-testid": "trailing-control" },
          "Control",
        ),
      }),
    );

    expect(markup).toContain('class="note-properties-footer"');
    expect(markup).toContain('class="note-properties-trailing"');
    expect(markup).toContain('data-testid="trailing-control"');
    expect(markup).toContain("Created");
    expect(markup).toContain("Updated");
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


  it("renders an accessible Add tag control", () => {
    const document = NoteDocument.create(createDocumentId(), "Tags", 100);
    const markup = renderToStaticMarkup(
      createElement(NoteProperties, {
        document,
        availableTags: ["research", "work"],
      }),
    );

    expect(markup).toContain('aria-label="Add tag"');
    expect(markup).toContain(">Add tag<");
  });

  it("suggests existing Project tags that are not on the current note", () => {
    expect(
      getTagAssignmentOptions(
        ["graph", "ideas", "research", "work"],
        ["research"],
        "",
      ),
    ).toEqual([
      { kind: "existing", tag: "graph" },
      { kind: "existing", tag: "ideas" },
      { kind: "existing", tag: "work" },
    ]);
  });

  it("filters tag suggestions case-insensitively without changing tag identity", () => {
    expect(
      getTagAssignmentOptions(
        ["Graph", "research", "work"],
        [],
        "GRA",
      ),
    ).toEqual([
      { kind: "existing", tag: "Graph" },
      { kind: "create", tag: "GRA" },
    ]);
  });

  it("offers creation for a new exact tag string", () => {
    expect(
      getTagAssignmentOptions(["research", "work"], [], "distributed-systems"),
    ).toEqual([
      { kind: "create", tag: "distributed-systems" },
    ]);
  });

  it("reuses the existing exact tag instead of offering duplicate creation", () => {
    expect(
      getTagAssignmentOptions(["research", "work"], [], "research"),
    ).toEqual([
      { kind: "existing", tag: "research" },
    ]);
  });

  it("allows differently cased tags because domain identity remains exact", () => {
    expect(
      getTagAssignmentOptions(["research"], [], "Research"),
    ).toEqual([
      { kind: "existing", tag: "research" },
      { kind: "create", tag: "Research" },
    ]);
  });


  it("moves through tag suggestions with wrapping keyboard semantics", () => {
    expect(moveTagOptionIndex(0, 3, "next")).toBe(1);
    expect(moveTagOptionIndex(2, 3, "next")).toBe(0);
    expect(moveTagOptionIndex(0, 3, "previous")).toBe(2);
    expect(moveTagOptionIndex(0, 0, "next")).toBe(0);
  });


  it("maps Escape and arrow keys to tag assignment commands", () => {
    expect(getTagInputCommand("Escape", 1, 3)).toEqual({ type: "close" });
    expect(getTagInputCommand("ArrowDown", 2, 3)).toEqual({
      type: "move",
      index: 0,
    });
    expect(getTagInputCommand("ArrowUp", 0, 3)).toEqual({
      type: "move",
      index: 2,
    });
    expect(getTagInputCommand("Tab", 0, 3)).toBeNull();
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
