/** @vitest-environment jsdom */

import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { liveMarkdownPreview } from "../src/live-markdown-preview.js";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("live Markdown preview", () => {
  it("mounts block replacement decorations through editor state", () => {
    const host = document.createElement("div");
    document.body.append(host);

    expect(() => {
      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: "# Active\n\nInactive **paragraph**.",
          selection: { anchor: 2 },
          extensions: [markdown(), liveMarkdownPreview],
        }),
      });
    }).not.toThrow();

    expect(host.querySelector(".live-markdown-block")).not.toBeNull();
    expect(host.textContent).toContain("Inactive paragraph");
  });

  it("renders ordered list item widgets with document numbering", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const source = ["1. first", "1. second", "1. third"].join("\n");

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: source,
        selection: { anchor: source.indexOf("second") },
        extensions: [markdown(), liveMarkdownPreview],
      }),
    });

    const markers = Array.from(
      host.querySelectorAll<HTMLElement>(".live-markdown-list-marker"),
    ).map((element) => element.textContent);

    expect(markers).toEqual(["1.", "3."]);
    expect(host.textContent).toContain("first");
    expect(host.textContent).toContain("second");
    expect(host.textContent).toContain("third");
  });

});
