import { NoteDocument, NoteProject } from "@floe-note/document";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NoteWorkspace } from "../src/NoteWorkspace.js";
import {
  PermanentDeleteConfirmation,
  TrashNotePreview,
  TrashView,
} from "../src/TrashView.js";

vi.mock("../src/MarkdownPreview.js", () => ({
  MarkdownPreview: ({
    document,
    interactive,
  }: {
    document: NoteDocument;
    interactive: boolean;
  }) =>
    createElement(
      "div",
      { "data-preview-interactive": String(interactive) },
      document.bodyText,
    ),
}));

vi.mock("../src/EditorModeView.js", () => ({
  EditorModeView: () => createElement("div", null, "Editor"),
}));

describe("TrashView", () => {
  it("renders an empty Trash state", () => {
    const project = NoteProject.create();
    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: null,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain("Trash is empty");
    expect(markup).toContain("Notes you delete will appear here.");
    expect(markup).not.toContain(">Restore<");
    expect(markup).not.toContain("Delete permanently");
  });

  it("renders Restore and Delete permanently in a selected deleted-note preview", async () => {
    const project = NoteProject.create();
    const document = project.createDocument("Deleted preview");
    document.setTags(["research", "draft"]);
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Preview body");
    binding.doc.commit();
    await Promise.resolve();
    project.deleteDocument(document.id);

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: document.id,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain("Deleted preview");
    expect(markup).toContain("research");
    expect(markup).toContain("draft");
    expect(markup).toContain("Preview body");
    expect(markup).toContain('data-preview-interactive="false"');
    expect(markup).toContain(">Restore<");
    expect(markup).toContain(">Delete permanently<");
    expect(markup).not.toContain("Add tag");
  });

  it("renders Restore and Delete permanently in the Trash list", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Deleted list item");
    project.deleteDocument(document.id);

    const requestPermanentDelete = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: null,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: requestPermanentDelete,
      }),
    );

    expect(markup).toContain("Deleted list item");
    expect(markup).toContain(">Restore<");
    expect(markup).toContain(">Delete permanently<");
  });

  it("does not expose Permanent delete for an active document", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Active");

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: document.id,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain("Trash is empty");
    expect(markup).not.toContain("Delete permanently");
  });

  it("does not expose Permanent delete in the active-note UI", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Active editor");

    const markup = renderToStaticMarkup(
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

    expect(markup).toContain("Delete note");
    expect(markup).toContain("<textarea");
    expect(markup).toContain('aria-label="Note title"');
    expect(markup).not.toContain("Delete permanently");
  });

  it("requesting Permanent delete does not itself purge the note", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Needs confirmation");
    project.deleteDocument(document.id);
    const requestPermanentDelete = vi.fn();

    const preview = TrashNotePreview({
      document,
      onRestore: vi.fn(),
      onRequestPermanentDelete: requestPermanentDelete,
    });
    const deleteButton = findButton(preview, "Delete permanently");
    expect(deleteButton).toBeDefined();

    deleteButton?.props.onClick();

    expect(requestPermanentDelete).toHaveBeenCalledOnce();
    expect(project.getDeletedDocument(document.id)).toBe(document);
    expect(project.isDocumentPurged(document.id)).toBe(false);
  });

  it("renders explicit permanent-delete confirmation wording", () => {
    const markup = renderToStaticMarkup(
      createElement(PermanentDeleteConfirmation, {
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );

    expect(markup).toContain("Permanently delete this note?");
    expect(markup).toContain("This note cannot be restored.");
    expect(markup).toContain(
      "Offline devices will apply the deletion when they reconnect.",
    );
    expect(markup).toContain(">Cancel<");
    expect(markup).toContain(">Delete permanently<");
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("autofocus");
  });

  it("Cancel leaves the note deleted and restorable", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Cancel purge");
    project.deleteDocument(document.id);
    const cancel = vi.fn();

    const confirmation = PermanentDeleteConfirmation({
      onCancel: cancel,
      onConfirm: () => project.purgeDocument(document.id),
    });
    const props = confirmation.props as {
      onClose: () => void;
    };

    props.onClose();

    expect(cancel).toHaveBeenCalledOnce();
    expect(project.getDeletedDocument(document.id)).toBe(document);
    expect(project.isDocumentPurged(document.id)).toBe(false);
  });

  it("confirmation purges the selected deleted note", async () => {
    const project = NoteProject.create();
    const document = project.createDocument("Confirm purge");
    project.deleteDocument(document.id);

    const confirmation = PermanentDeleteConfirmation({
      onCancel: vi.fn(),
      onConfirm: () => project.purgeDocument(document.id),
    });
    const props = confirmation.props as {
      onConfirm: () => Promise<void>;
    };

    await props.onConfirm();

    expect(project.isDocumentPurged(document.id)).toBe(true);
    expect(project.getDeletedDocument(document.id)).toBeUndefined();
    expect(project.listDeletedDocuments()).toEqual([]);
  });

  it("shows the Trash empty state instead of a stale preview after the selected note is purged", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Last deleted note");
    project.deleteDocument(document.id);
    project.purgeDocument(document.id);

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project,
        selectedDocumentId: document.id,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain("Trash is empty");
    expect(markup).not.toContain("Last deleted note");
    expect(markup).not.toContain(">Restore<");
    expect(markup).not.toContain(">Delete permanently<");
  });

  it("drops a selected stale preview when a remote purge manifest arrives", () => {
    const source = NoteProject.create();
    const document = source.createDocument("Remote purge");
    source.deleteDocument(document.id);

    const targetDocument = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const target = NoteProject.fromSnapshot(
      source.id,
      source.exportManifestSnapshot(),
      [targetDocument],
    );

    source.purgeDocument(document.id);
    target.importManifestUpdate(source.exportManifestUpdate());

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project: target,
        selectedDocumentId: document.id,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(target.isDocumentPurged(document.id)).toBe(true);
    expect(markup).toContain("Trash is empty");
    expect(markup).not.toContain("Remote purge");
    expect(markup).not.toContain("Delete permanently");
  });

  it("reflects a remote manifest delete in the Trash UI", () => {
    const source = NoteProject.create();
    const document = source.createDocument("Remote deletion");
    const targetDocument = NoteDocument.fromSnapshot(
      document.id,
      document.exportSnapshot(),
    );
    const target = NoteProject.fromSnapshot(
      source.id,
      source.exportManifestSnapshot(),
      [targetDocument],
    );

    source.deleteDocument(document.id);
    target.importManifestUpdate(source.exportManifestUpdate());

    const markup = renderToStaticMarkup(
      createElement(TrashView, {
        project: target,
        selectedDocumentId: null,
        onSelectDocument: vi.fn(),
        onRestoreDocument: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain("Remote deletion");
    expect(markup).toContain(">Restore<");
    expect(markup).toContain(">Delete permanently<");
  });
});

type ButtonElement = ReturnType<typeof createElement> & {
  props: {
    children?: ReactNode;
    onClick: () => void;
  };
};

function findButton(
  node: ReactNode,
  label: string,
): ButtonElement | undefined {
  if (!isValidElement(node)) return undefined;

  const props = node.props as {
    children?: ReactNode;
    onClick?: () => void;
  };

  if (
    node.type === "button" &&
    props.children === label &&
    props.onClick
  ) {
    return node as ButtonElement;
  }

  const children = Array.isArray(props.children)
    ? props.children
    : [props.children];
  for (const child of children) {
    const match = findButton(child, label);
    if (match) return match;
  }

  return undefined;
}
