/** @vitest-environment jsdom */

import { NoteDocument, NoteProject } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteWorkspace } from "../src/NoteWorkspace.js";

vi.mock("../src/MarkdownPreview.js", () => ({
  MarkdownPreview: ({ document }: { document: NoteDocument }) =>
    createElement("div", null, document.bodyText),
}));

vi.mock("../src/EditorModeView.js", () => ({
  EditorModeView: () => createElement("div", null, "Editor"),
}));

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

function renderTrashWorkspace(
  project: NoteProject,
  trashDocumentId: ReturnType<NoteProject["createDocument"]>["id"] | null,
  onOpenTrash: () => void,
  onSelectTrashDocument: (documentId: typeof trashDocumentId) => void,
): HTMLDivElement {
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
        trashActive: true,
        trashDocumentId,
        onTitleFocusHandled: vi.fn(),
        onCreateDocument: vi.fn(),
        onSelectDocument: vi.fn(),
        onRenameDocument: vi.fn(),
        onDeleteDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onPurgeDocument: vi.fn(),
        onOpenTrash,
        onSelectTrashDocument,
      }),
    );
  });

  return container;
}

describe("NoteWorkspace routing callbacks", () => {
  it("normalizes an omitted Trash route selection instead of passing undefined to the domain", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Active");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    expect(() => {
      act(() => {
        root?.render(
          createElement(NoteWorkspace, {
            project,
            selectedId: document.id,
            selectedDocument: document,
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
    }).not.toThrow();
  });

  it("reports Trash document to Trash root navigation explicitly", () => {
    const project = NoteProject.create();
    const deleted = project.createDocument("Deleted");
    project.deleteDocument(deleted.id);

    const onOpenTrash = vi.fn();
    const onSelectTrashDocument = vi.fn();
    const view = renderTrashWorkspace(
      project,
      deleted.id,
      onOpenTrash,
      onSelectTrashDocument,
    );

    const trashRoot = view.querySelector<HTMLButtonElement>(
      ".sidebar-trash-entry",
    );
    expect(trashRoot).not.toBeNull();

    act(() => {
      trashRoot?.click();
    });

    expect(onSelectTrashDocument).toHaveBeenCalledWith(null);
    expect(onOpenTrash).toHaveBeenCalledOnce();
  });

  it("reports deleted-note selection to the routing owner", () => {
    const project = NoteProject.create();
    const deleted = project.createDocument("Deleted");
    project.deleteDocument(deleted.id);

    const onOpenTrash = vi.fn();
    const onSelectTrashDocument = vi.fn();
    const view = renderTrashWorkspace(
      project,
      null,
      onOpenTrash,
      onSelectTrashDocument,
    );

    const trashRoot = view.querySelector<HTMLButtonElement>(
      ".sidebar-trash-entry",
    );
    act(() => {
      trashRoot?.click();
    });

    const deletedNote = view.querySelector<HTMLButtonElement>(
      ".sidebar-trash-note-item",
    );
    expect(deletedNote).not.toBeNull();

    act(() => {
      deletedNote?.click();
    });

    expect(onSelectTrashDocument).toHaveBeenLastCalledWith(deleted.id);
  });
});
