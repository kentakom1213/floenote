/** @vitest-environment jsdom */

import {
  getSearchQuery,
  openSearchPanel,
} from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import { afterEach, describe, expect, it } from "vitest";

import { floeEditorSearch } from "../src/MarkdownEditor.js";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

async function openEditorSearch(readOnly = false): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);

  view = new EditorView({
    parent: host,
    extensions: [
      floeEditorSearch,
      EditorState.readOnly.of(readOnly),
    ],
  });

  expect(openSearchPanel(view)).toBe(true);
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });

  const searchPanels = view.dom.querySelectorAll<HTMLElement>(".cm-search");
  expect(searchPanels).toHaveLength(1);
  expect(view.dom.querySelector(".cm-panels-top .cm-search")).toBe(
    searchPanels[0],
  );
  expect(view.dom.querySelector(".cm-panels-bottom .cm-search")).toBeNull();
  expect(view.dom.querySelector(".editor-search-position-preview")).toBeNull();

  return searchPanels[0]!;
}

describe("editor search panel", () => {
  it("keeps one real top panel and collapses Replace by default", async () => {
    const panel = await openEditorSearch();

    const replaceToggle = panel.querySelector<HTMLButtonElement>(
      "[data-floe-replace-toggle]",
    );
    expect(replaceToggle).not.toBeNull();
    expect(panel.dataset.floeReplaceOpen).toBe("false");
    expect(replaceToggle?.getAttribute("aria-expanded")).toBe("false");

    replaceToggle?.click();
    expect(panel.dataset.floeReplaceOpen).toBe("true");
    expect(replaceToggle?.getAttribute("aria-expanded")).toBe("true");

    replaceToggle?.click();
    expect(panel.dataset.floeReplaceOpen).toBe("false");
  });

  it("adds presentation chrome without duplicating CodeMirror search options", async () => {
    const panel = await openEditorSearch();
    const optionsToggle = panel.querySelector<HTMLButtonElement>(
      "[data-floe-search-options-toggle]",
    );
    const optionsMenu = panel.querySelector<HTMLElement>(
      "[data-floe-search-options]",
    );

    expect(optionsToggle).not.toBeNull();
    expect(optionsToggle?.getAttribute("aria-haspopup")).toBe("true");
    expect(optionsToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(optionsToggle?.getAttribute("aria-label")).toBe(
      "Show search options",
    );
    expect(optionsToggle?.title).toBe("Show search options");
    expect(optionsMenu?.getAttribute("role")).toBe("group");
    expect(optionsMenu?.getAttribute("aria-label")).toBe("Search options");
    expect(optionsMenu?.textContent).toContain("Match case");
    expect(optionsMenu?.textContent).toContain("Regular expression");
    expect(optionsMenu?.textContent).toContain("Whole word");

    for (const name of ["case", "re", "word"]) {
      const controls = panel.querySelectorAll<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      expect(controls).toHaveLength(1);
      expect(optionsMenu?.contains(controls[0]!)).toBe(true);
    }

    optionsToggle?.click();
    expect(panel.dataset.floeSearchOptionsOpen).toBe("true");
    expect(optionsToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(optionsToggle?.getAttribute("aria-label")).toBe(
      "Hide search options",
    );

    const caseControl =
      panel.querySelector<HTMLInputElement>('input[name="case"]');
    caseControl?.click();
    expect(getSearchQuery(view!.state).caseSensitive).toBe(true);

    optionsToggle?.click();
    expect(panel.dataset.floeSearchOptionsOpen).toBe("false");
    expect(caseControl?.checked).toBe(true);
  });

  it("enhances read-only search without adding Replace controls", async () => {
    const panel = await openEditorSearch(true);

    expect(panel.querySelector('input[name="replace"]')).toBeNull();
    expect(panel.querySelector("[data-floe-replace-toggle]")).toBeNull();

    expect(
      panel.querySelector<HTMLElement>('[name="prev"]')?.title,
    ).toBe("Previous match");
    expect(
      panel.querySelector<HTMLElement>('[name="next"]')?.title,
    ).toBe("Next match");

    expect(
      panel
        .querySelector<HTMLInputElement>('input[name="case"]')
        ?.closest("label")?.title,
    ).toBe("Match case");
    expect(
      panel
        .querySelector<HTMLInputElement>('input[name="re"]')
        ?.closest("label")?.title,
    ).toBe("Use regular expression");
    expect(
      panel
        .querySelector<HTMLInputElement>('input[name="word"]')
        ?.closest("label")?.title,
    ).toBe("Match whole word");

    expect(
      panel.querySelector("[data-floe-search-options-toggle]"),
    ).not.toBeNull();
  });

  it("keeps top-row DOM order aligned with the visual Previous/Next order", async () => {
    const panel = await openEditorSearch();

    const search = panel.querySelector('[name="search"]');
    const previous = panel.querySelector('[name="prev"]');
    const next = panel.querySelector('[name="next"]');
    const selectAll = panel.querySelector('[name="select"]');
    const optionsToggle = panel.querySelector(
      "[data-floe-search-options-toggle]",
    );
    const optionsMenu = panel.querySelector("[data-floe-search-options]");
    const close = panel.querySelector('[name="close"]');
    const lineBreak = panel.querySelector("br");

    expect(search?.nextElementSibling).toBe(previous);
    expect(previous?.nextElementSibling).toBe(next);
    expect(next?.nextElementSibling).toBe(selectAll);
    expect(selectAll?.nextElementSibling).toBe(optionsToggle);
    expect(optionsToggle?.nextElementSibling).toBe(optionsMenu);
    expect(optionsMenu?.nextElementSibling).toBe(close);
    expect(close?.nextElementSibling).toBe(lineBreak);
  });
});
