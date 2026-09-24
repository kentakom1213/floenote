/** @vitest-environment jsdom */

import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorModeView } from "../src/EditorModeView.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Split task-list interaction", () => {
  it("reflects a Preview checkbox toggle in CodeMirror immediately", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    const note = NoteDocument.createWithInitialState(createDocumentId(), {
      title: "Split task",
      body: "- [ ] task",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(EditorModeView, {
            document: note,
            mode: "split",
          }),
        );
        await Promise.resolve();
      });

      const checkbox = container.querySelector<HTMLInputElement>(
        ".markdown-task-checkbox",
      );
      const content = container.querySelector<HTMLElement>(".cm-content");

      expect(checkbox).not.toBeNull();
      expect(content?.textContent).toContain("- [ ] task");

      await act(async () => {
        checkbox?.click();
        await Promise.resolve();
      });

      expect(note.bodyText).toBe("- [x] task");
      expect(content?.textContent).toContain("- [x] task");
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
