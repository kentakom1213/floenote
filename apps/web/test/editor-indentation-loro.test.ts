/** @vitest-environment jsdom */

import { NoteDocument } from "@floe-note/document";
import { createDocumentId } from "@floe-note/domain";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../src/MarkdownEditor.js";

let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Markdown editor indentation with Loro undo", () => {
  it("syncs Tab indentation to Loro and undoes/redoes through Loro history", async () => {
    const { note, content } = await renderEditor("plain text");

    await pressKey(content, { key: "Tab" });
    expect(note.bodyText).toBe("   plain text");

    await pressKey(content, { key: "z", ctrlKey: true });
    expect(note.bodyText).toBe("plain text");

    await pressKey(content, { key: "y", ctrlKey: true });
    expect(note.bodyText).toBe("   plain text");
  });

  it("syncs Shift+Tab dedentation to Loro and undoes it as one action", async () => {
    const { note, content } = await renderEditor("   plain text");

    await pressKey(content, { key: "Tab", shiftKey: true });
    expect(note.bodyText).toBe("plain text");

    await pressKey(content, { key: "z", ctrlKey: true });
    expect(note.bodyText).toBe("   plain text");
  });
});

async function renderEditor(body: string): Promise<{
  note: NoteDocument;
  content: HTMLElement;
}> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const note = NoteDocument.createWithInitialState(createDocumentId(), {
    title: "Indentation",
    body,
    createdAt: 100,
    updatedAt: 100,
    tags: [],
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(createElement(MarkdownEditor, { document: note }));
    await Promise.resolve();
    await Promise.resolve();
  });

  const content = container.querySelector<HTMLElement>(".cm-content");
  expect(content).not.toBeNull();
  content?.focus();

  return { note, content: content! };
}

async function pressKey(
  target: HTMLElement,
  init: KeyboardEventInit,
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    await Promise.resolve();
  });
}
