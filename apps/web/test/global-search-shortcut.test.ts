/** @vitest-environment jsdom */

import { NoteProject } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteWorkspace } from "../src/NoteWorkspace.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../src/GlobalSearch.js", () => ({
  GlobalSearch: () =>
    createElement("div", { "data-testid": "global-search" }, "Global search"),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  const project = NoteProject.create();

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      createElement(NoteWorkspace, {
        project,
        selectedId: null,
        selectedDocument: undefined,
        projectControl: createElement("div"),
        sidebarFooter: createElement("div"),
        trashActive: false,
        onTitleFocusHandled: vi.fn(),
        onCreateDocument: vi.fn(),
        onSelectDocument: vi.fn(),
        onRenameDocument: vi.fn(),
        onDeleteDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onPurgeDocument: vi.fn(),
        onOpenTrash: vi.fn(),
      }),
    );
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("global search shortcut", () => {
  it("opens global search for Ctrl+K", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(container?.querySelector('[data-testid="global-search"]')).not.toBeNull();
  });

  it("does not intercept Ctrl+Shift+K", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(container?.querySelector('[data-testid="global-search"]')).toBeNull();
  });
});
