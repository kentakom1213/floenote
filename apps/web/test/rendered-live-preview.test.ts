/** @vitest-environment jsdom */

import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownRenderedLivePreview } from "../src/MarkdownRenderedLivePreview.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("rendered live preview", () => {
  it("edits one rendered paragraph and commits the source range on blur", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const note = NoteDocument.create(createDocumentId(), "Live", 100);
    const binding = note.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Heading\n\nOriginal paragraph.");
    binding.doc.commit();
    await Promise.resolve();

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(MarkdownRenderedLivePreview, { document: note }));
      });

      const paragraph = container.querySelector("p[data-floe-source-from]");
      expect(paragraph?.textContent).toBe("Original paragraph.");

      await act(async () => {
        paragraph?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const textarea =
        container.querySelector<HTMLTextAreaElement>(".markdown-live-editor");
      expect(textarea?.value).toBe("Original paragraph.");

      if (!textarea) throw new Error("Expected live editor textarea");
      textarea.value = "Edited **paragraph**.";

      await act(async () => {
        textarea.blur();
        await Promise.resolve();
      });

      expect(note.bodyText).toBe("# Heading\n\nEdited **paragraph**.");
      expect(container.textContent).toContain("Edited paragraph.");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("edits a parent list item without replacing its nested list", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const note = NoteDocument.create(createDocumentId(), "Nested", 100);
    const source = [
      "- parent",
      "  - child",
      "    - grandchild",
      "  - sibling",
    ].join("\n");
    const binding = note.getEditorBinding();
    binding.getText(binding.doc).insert(0, source);
    binding.doc.commit();
    await Promise.resolve();

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MarkdownRenderedLivePreview, { document: note }),
        );
      });

      const blocks = Array.from(
        container.querySelectorAll<HTMLElement>(
          ".markdown-live-list-item-content",
        ),
      );
      expect(blocks.map((block) => block.textContent?.trim())).toEqual([
        "parent",
        "child",
        "grandchild",
        "sibling",
      ]);

      await act(async () => {
        blocks[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const textarea =
        container.querySelector<HTMLTextAreaElement>(".markdown-live-editor");
      expect(textarea?.value.trimStart()).toBe("- parent");
      expect(container.textContent).toContain("child");
      expect(container.textContent).toContain("grandchild");

      if (!textarea) throw new Error("Expected parent list item editor");
      textarea.value = "- renamed parent";

      await act(async () => {
        textarea.blur();
        await Promise.resolve();
      });

      expect(note.bodyText).toBe(
        [
          "- renamed parent",
          "  - child",
          "    - grandchild",
          "  - sibling",
        ].join("\n"),
      );
      expect(container.textContent).toContain("renamed parent");
      expect(container.textContent).toContain("grandchild");
    } finally {
      await act(async () => root.unmount());
    }
  });

});
