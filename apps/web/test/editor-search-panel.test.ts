/** @vitest-environment jsdom */

import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "codemirror";
import { afterEach, describe, expect, it } from "vitest";

import { floeEditorSearch } from "../src/MarkdownEditor.js";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("editor search panel", () => {
  it("opens in the top panel container", () => {
    const host = document.createElement("div");
    document.body.append(host);

    view = new EditorView({
      parent: host,
      extensions: [floeEditorSearch],
    });

    expect(openSearchPanel(view)).toBe(true);

    const searchPanels = view.dom.querySelectorAll(".cm-search");
    expect(searchPanels).toHaveLength(1);
    expect(view.dom.querySelector(".cm-panels-top .cm-search")).toBe(
      searchPanels[0],
    );
    expect(view.dom.querySelector(".cm-panels-bottom .cm-search")).toBeNull();
    expect(
      view.dom.querySelector(".editor-search-position-preview"),
    ).toBeNull();
  });
});
