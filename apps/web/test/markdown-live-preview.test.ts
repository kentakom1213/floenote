import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { LoroDoc, UndoManager } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { collectMarkdownLivePreviewTokens } from "../src/markdown-live-preview-syntax.js";

function markdownState(source: string, anchor = source.length): EditorState {
  return EditorState.create({
    doc: source,
    selection: { anchor },
    extensions: [markdown()],
  });
}

describe("Markdown Live Preview syntax", () => {
  it("keeps raw Markdown as the editor source", () => {
    const source =
      "# Heading\n\n*emphasis* **strong** `inline` [link](https://example.com)\n\n- item\n> quote";
    const state = markdownState(source);

    collectMarkdownLivePreviewTokens(state);

    expect(state.doc.toString()).toBe(source);
  });

  it("recognizes the main v1 syntax classes", () => {
    const source =
      "# Heading\n\n*emphasis* **strong** `inline` [link](https://example.com)\n\n- item\n> quote";
    const tokens = collectMarkdownLivePreviewTokens(markdownState(source));
    const kinds = new Set(tokens.map((token) => token.kind));

    expect(kinds).toContain("heading");
    expect(kinds).toContain("emphasis");
    expect(kinds).toContain("strong");
    expect(kinds).toContain("inline-code");
    expect(kinds).toContain("link");
    expect(kinds).toContain("list-marker");
    expect(kinds).toContain("blockquote-line");
    expect(kinds).toContain("hidden-syntax");
  });

  it("reveals formatting syntax when the cursor enters that construct", () => {
    const source = "before **strong text** after";
    const cursor = source.indexOf("strong") + 2;
    const tokens = collectMarkdownLivePreviewTokens(
      markdownState(source, cursor),
    );
    const strong = tokens.find((token) => token.kind === "strong");

    expect(strong).toBeDefined();
    expect(strong?.kind === "strong" && strong.active).toBe(true);

    if (!strong || strong.kind !== "strong") {
      throw new Error("Strong token was not parsed");
    }

    const hiddenInsideStrong = tokens.filter(
      (token) =>
        token.kind === "hidden-syntax" &&
        token.from >= strong.from &&
        token.to <= strong.to,
    );
    expect(hiddenInsideStrong).toEqual([]);
  });

  it("keeps syntax hidden when the cursor is outside a construct", () => {
    const source = "**strong text** after";
    const tokens = collectMarkdownLivePreviewTokens(
      markdownState(source, source.length),
    );
    const strong = tokens.find((token) => token.kind === "strong");

    expect(strong).toBeDefined();
    expect(strong?.kind === "strong" && strong.active).toBe(false);
    expect(
      tokens.some((token) => token.kind === "hidden-syntax"),
    ).toBe(true);
  });

  it("preserves pasted Markdown source text", () => {
    const initial = markdownState("before");
    const pasted = " **pasted** and `code`";
    const next = initial.update({
      changes: {
        from: initial.doc.length,
        insert: pasted,
      },
    }).state;

    collectMarkdownLivePreviewTokens(next);

    expect(next.doc.toString()).toBe(`before${pasted}`);
  });

  it("tracks remote CRDT Markdown without changing the source", async () => {
    const id = createDocumentId();
    const source = NoteDocument.create(id, "Source", 100);
    const target = NoteDocument.fromSnapshot(id, source.exportSnapshot());
    const binding = source.getEditorBinding();
    const markdownSource = "# Remote\n\n**update**";

    binding.getText(binding.doc).insert(0, markdownSource);
    binding.doc.commit();
    await Promise.resolve();

    target.importUpdate(source.exportUpdate());

    expect(target.bodyText).toBe(markdownSource);
    const tokens = collectMarkdownLivePreviewTokens(
      markdownState(target.bodyText),
    );
    expect(tokens.some((token) => token.kind === "heading")).toBe(true);
    expect(tokens.some((token) => token.kind === "strong")).toBe(true);
  });

  it("keeps Markdown source intact across snapshot reload", async () => {
    const id = createDocumentId();
    const document = NoteDocument.create(id, "Reload", 100);
    const binding = document.getEditorBinding();
    const source = "# Reload\n\n[link](https://example.com)";

    binding.getText(binding.doc).insert(0, source);
    binding.doc.commit();
    await Promise.resolve();

    const restored = NoteDocument.fromSnapshot(
      id,
      document.exportSnapshot(),
    );

    expect(restored.bodyText).toBe(source);
  });

  it("preserves the underlying Loro undo and redo behavior", () => {
    const doc = new LoroDoc();
    const text = doc.getText("body");
    const undo = new UndoManager(doc, { mergeInterval: 0 });

    text.insert(0, "**editable**");
    doc.commit();

    expect(text.toString()).toBe("**editable**");
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe("");
    expect(undo.redo()).toBe(true);
    expect(text.toString()).toBe("**editable**");
  });
});
