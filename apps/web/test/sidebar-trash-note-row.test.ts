import { createDocumentId } from "@floe-note/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  SidebarTrashNoteMenu,
  SidebarTrashNoteRow,
} from "../src/SidebarTrashNoteRow.js";

describe("SidebarTrashNoteRow", () => {
  it("matches the note-row action trigger pattern", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarTrashNoteRow, {
        id: createDocumentId(),
        title: "Deleted note",
        selected: true,
        onSelect: vi.fn(),
        onRestore: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain("note-row sidebar-trash-note-row selected");
    expect(markup).toContain("Deleted note");
    expect(markup).toContain('aria-label="Actions for Deleted note"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("renders Restore and Delete permanently in the action menu", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarTrashNoteMenu, {
        onRestore: vi.fn(),
        onRequestPermanentDelete: vi.fn(),
      }),
    );

    expect(markup).toContain(">Restore<");
    expect(markup).toContain(">Delete permanently<");
    expect(markup).toContain("note-row-menu-item danger");
    expect(markup).toContain('role="menuitem"');
  });
});
