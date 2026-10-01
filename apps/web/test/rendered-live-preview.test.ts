/** @vitest-environment jsdom */

import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownRenderedLivePreview } from "../src/MarkdownRenderedLivePreview.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("rendered live preview", () => {
  it("edits one rendered paragraph and commits the source range on blur", async () => {
    const fixture = await renderLive("# Heading\n\nOriginal paragraph.");

    try {
      const paragraph = fixture.container.querySelector(
        "p[data-floe-source-from]",
      );
      expect(paragraph?.textContent).toBe("Original paragraph.");

      await click(paragraph);

      const textarea = liveEditor(fixture.container);
      expect(textarea.value).toBe("Original paragraph.");
      textarea.value = "Edited **paragraph**.";

      await act(async () => {
        textarea.blur();
        await Promise.resolve();
      });

      expect(fixture.note.bodyText).toBe(
        "# Heading\n\nEdited **paragraph**.",
      );
      expect(fixture.container.textContent).toContain("Edited paragraph.");
    } finally {
      await unmount(fixture.root);
    }
  });

  it("edits a parent list item without replacing its nested list", async () => {
    const source = [
      "- parent",
      "  - child",
      "    - grandchild",
      "  - sibling",
    ].join("\n");
    const fixture = await renderLive(source);

    try {
      const blocks = listBlocks(fixture.container);
      expect(blocks.map((block) => block.textContent?.trim())).toEqual([
        "parent",
        "child",
        "grandchild",
        "sibling",
      ]);

      await click(blocks[0] ?? null);

      const textarea = liveEditor(fixture.container);
      expect(textarea.value.trimStart()).toBe("- parent");
      expect(fixture.container.textContent).toContain("child");
      expect(fixture.container.textContent).toContain("grandchild");

      textarea.value = "- renamed parent";

      await act(async () => {
        textarea.blur();
        await Promise.resolve();
      });

      expect(fixture.note.bodyText).toBe(
        [
          "- renamed parent",
          "  - child",
          "    - grandchild",
          "  - sibling",
        ].join("\n"),
      );
      expect(fixture.container.textContent).toContain("renamed parent");
      expect(fixture.container.textContent).toContain("grandchild");
    } finally {
      await unmount(fixture.root);
    }
  });

  it("commits the active block and selects it on Escape", async () => {
    const fixture = await renderLive("Original");

    try {
      await click(
        fixture.container.querySelector("p[data-floe-source-from]"),
      );

      const textarea = liveEditor(fixture.container);
      textarea.value = "Edited";

      await key(textarea, "Escape");

      expect(fixture.note.bodyText).toBe("Edited");
      const selected = fixture.container.querySelector(
        ".markdown-live-selected-block",
      );
      expect(selected?.textContent).toBe("Edited");
      expect(document.activeElement).toBe(selected);
    } finally {
      await unmount(fixture.root);
    }
  });

  it("creates a pending paragraph on Enter and commits it without a sentinel", async () => {
    const fixture = await renderLive("First\n\nSecond");

    try {
      const first = fixture.container.querySelector(
        "p[data-floe-source-from]",
      );
      await click(first);

      const textarea = liveEditor(fixture.container);
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      await key(textarea, "Enter");

      expect(fixture.note.bodyText).toBe("First\n\nSecond");
      const pending = fixture.container.querySelector<HTMLTextAreaElement>(
        ".markdown-live-pending-editor",
      );
      expect(pending?.value).toBe("");

      if (!pending) throw new Error("Expected pending paragraph editor");
      pending.value = "Inserted";
      await key(pending, "Escape");

      expect(fixture.note.bodyText).toBe(
        "First\n\nInserted\n\nSecond",
      );
      expect(
        fixture.container.querySelector(".markdown-live-selected-block")
          ?.textContent,
      ).toBe("Inserted");
    } finally {
      await unmount(fixture.root);
    }
  });

  it("creates a same-level list item after the current subtree", async () => {
    const source = ["- parent", "  - child", "- second"].join("\n");
    const fixture = await renderLive(source);

    try {
      const parent = listBlocks(fixture.container)[0] ?? null;
      await click(parent);

      const textarea = liveEditor(fixture.container);
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      await key(textarea, "Enter");

      const pending = fixture.container.querySelector<HTMLTextAreaElement>(
        ".markdown-live-pending-editor",
      );
      expect(pending?.value).toBe("- ");

      if (!pending) throw new Error("Expected pending list item editor");
      pending.value = "- inserted";
      await key(pending, "Escape");

      expect(fixture.note.bodyText).toBe(
        ["- parent", "  - child", "- inserted", "- second"].join("\n"),
      );
    } finally {
      await unmount(fixture.root);
    }
  });

  it("moves editing to adjacent blocks with ArrowUp and ArrowDown", async () => {
    const fixture = await renderLive("First\n\nSecond");

    try {
      await click(
        fixture.container.querySelector("p[data-floe-source-from]"),
      );

      let textarea = liveEditor(fixture.container);
      textarea.value = "First edited";
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      await key(textarea, "ArrowDown");

      expect(fixture.note.bodyText).toBe("First edited\n\nSecond");
      textarea = liveEditor(fixture.container);
      expect(textarea.value).toBe("Second");
      expect(textarea.selectionStart).toBe(0);

      textarea.setSelectionRange(0, 0);
      await key(textarea, "ArrowUp");

      textarea = liveEditor(fixture.container);
      expect(textarea.value).toBe("First edited");
      expect(textarea.selectionStart).toBe(textarea.value.length);
    } finally {
      await unmount(fixture.root);
    }
  });
});

async function renderLive(source: string): Promise<{
  note: NoteDocument;
  container: HTMLDivElement;
  root: Root;
}> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const note = NoteDocument.create(createDocumentId(), "Live", 100);
  const binding = note.getEditorBinding();
  binding.getText(binding.doc).insert(0, source);
  binding.doc.commit();
  await Promise.resolve();

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(MarkdownRenderedLivePreview, { document: note }));
  });

  return { note, container, root };
}

async function click(element: Element | null): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function key(
  element: HTMLTextAreaElement,
  keyName: string,
): Promise<void> {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: keyName, bubbles: true }),
    );
    await Promise.resolve();
  });
}

function liveEditor(container: HTMLElement): HTMLTextAreaElement {
  const textarea =
    container.querySelector<HTMLTextAreaElement>(".markdown-live-editor");
  if (!textarea) throw new Error("Expected live editor textarea");
  return textarea;
}

function listBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      ".markdown-live-list-item-content",
    ),
  );
}

async function unmount(root: Root): Promise<void> {
  await act(async () => root.unmount());
}
