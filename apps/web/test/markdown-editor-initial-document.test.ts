/** @vitest-environment jsdom */

import { NoteDocument } from "@floe-note/document";
import { createDocumentId } from "@floe-note/domain";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("loro-codemirror", () => ({
  LoroExtensions: () => [],
}));

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

describe("Markdown editor initial document", () => {
  it("shows an existing note body without relying on the Loro binding initial sync", async () => {
    const body = "Imported body from portable archive";
    const note = createNote(body);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    await act(async () => {
      root?.render(createElement(MarkdownEditor, { document: note }));
      await Promise.resolve();
    });

    expect(
      container.querySelector<HTMLElement>(".cm-content")?.textContent,
    ).toBe(body);
    expect(note.bodyText).toBe(body);
  });

  it("reinitializes the source when switching to another existing note", async () => {
    const first = createNote("First imported note");
    const second = createNote("Second imported note");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    await act(async () => {
      root?.render(createElement(MarkdownEditor, { document: first }));
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLElement>(".cm-content")?.textContent,
    ).toBe(first.bodyText);

    await act(async () => {
      root?.render(createElement(MarkdownEditor, { document: second }));
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLElement>(".cm-content")?.textContent,
    ).toBe(second.bodyText);
  });
});

function createNote(body: string): NoteDocument {
  return NoteDocument.createWithInitialState(createDocumentId(), {
    title: "Imported",
    body,
    createdAt: 100,
    updatedAt: 100,
    tags: [],
  });
}
