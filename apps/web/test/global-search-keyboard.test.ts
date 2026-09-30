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

describe("GlobalSearch keyboard interaction", () => {
  it("does not select a result when Enter confirms IME composition", () => {
    const onSelect = vi.fn();
    const input = renderSearch(["Alpha", "Beta"], onSelect);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onSelect).not.toHaveBeenCalled();

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("scrolls the keyboard-active recent result into view as needed", () => {
    const scrollIntoView = mockScrollIntoView();
    const input = renderSearch(["Alpha", "Beta", "Gamma"], vi.fn());

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const active = container?.querySelector<HTMLButtonElement>(
      ".global-search-result.active",
    );
    expect(active).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(active);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      inline: "nearest",
    });

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("keeps the active filtered search result visible during keyboard navigation", () => {
    const scrollIntoView = mockScrollIntoView();
    const input = renderSearch(
      ["Match Alpha", "Match Beta", "Match Gamma"],
      vi.fn(),
    );

    act(() => {
      setInputValue(input, "match");
    });
    scrollIntoView.mockClear();

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });
});

function renderSearch(
  titles: readonly string[],
  onSelect: ReturnType<typeof vi.fn>,
): HTMLInputElement {
  const workspace = NoteProject.create();
  const openedAt = new Map();

  titles.forEach((title, index) => {
    const note = workspace.createDocument(title);
    openedAt.set(note.id, titles.length - index);
  });

  const cache = new GlobalSearchCache();
  cache.syncProject(workspace);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      createElement(GlobalSearch, {
        cache,
        lastOpenedAt: openedAt,
        getTagColor: () => "gray" as const,
        onClose: vi.fn(),
        onSelect,
      }),
    );
  });

  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search all notes"]',
  );
  expect(input).not.toBeNull();
  return input!;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mockScrollIntoView() {
  const mock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: mock,
  });
  return mock;
}
