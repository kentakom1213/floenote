/** @vitest-environment jsdom */

import { NoteProject } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "../src/GlobalSearch.js";
import { GlobalSearchCache } from "../src/global-search.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("GlobalSearch tag rendering", () => {
  it("uses the shared Project-colored TagChip for matched tags", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Tagged note",
      body: "",
      createdAt: 100,
      updatedAt: 100,
      tags: ["research"],
    });
    project.setTagColor("research", "blue");

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    container = documentNode();
    root = createRoot(container);

    act(() => {
      root?.render(
        createElement(GlobalSearch, {
          cache,
          lastOpenedAt: new Map(),
          getTagColor: (tag: string) => project.getTagColor(tag),
          onClose: vi.fn(),
          onSelect: vi.fn(),
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search all notes"]',
    );
    expect(input).not.toBeNull();

    act(() => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "research");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const chip = container.querySelector(
      '.global-search-result-tags .tag-chip[data-tag-color="blue"]',
    );
    expect(chip?.textContent).toBe("research");
    expect(container.textContent).toContain(document.title);
  });
});

function documentNode(): HTMLDivElement {
  const node = document.createElement("div");
  document.body.append(node);
  return node;
}
