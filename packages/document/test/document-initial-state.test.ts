import { describe, expect, it } from "vitest";

import { createDocumentId } from "@floe-note/domain";

import { NoteDocument } from "../src/index.js";

describe("NoteDocument initial state", () => {
  it("constructs body and metadata without replacing imported timestamps", async () => {
    const createdAt = 1_700_000_000_000;
    const updatedAt = 1_700_000_123_456;
    const document = NoteDocument.createWithInitialState(createDocumentId(), {
      title: "Imported",
      body: "# Imported\n\nBody",
      createdAt,
      updatedAt,
      tags: ["portable", "research"],
    });

    await Promise.resolve();

    expect(document.title).toBe("Imported");
    expect(document.bodyText).toBe("# Imported\n\nBody");
    expect(document.createdAt).toBe(createdAt);
    expect(document.updatedAt).toBe(updatedAt);
    expect(document.tags).toEqual(["portable", "research"]);
  });

  it("round-trips the initial state through a Loro snapshot", () => {
    const id = createDocumentId();
    const original = NoteDocument.createWithInitialState(id, {
      title: "Same title",
      body: "---\nfrontmatter: body\n---",
      createdAt: 100,
      updatedAt: 200,
      tags: ["one", "two"],
    });

    const restored = NoteDocument.fromSnapshot(id, original.exportSnapshot());

    expect(restored.title).toBe(original.title);
    expect(restored.bodyText).toBe(original.bodyText);
    expect(restored.createdAt).toBe(100);
    expect(restored.updatedAt).toBe(200);
    expect(restored.tags).toEqual(["one", "two"]);
  });

  it("rejects invalid initial timestamps", () => {
    expect(() =>
      NoteDocument.createWithInitialState(createDocumentId(), {
        title: "Invalid",
        body: "",
        createdAt: Number.NaN,
        updatedAt: 100,
        tags: [],
      }),
    ).toThrow("createdAt must be a finite timestamp");
  });
});
