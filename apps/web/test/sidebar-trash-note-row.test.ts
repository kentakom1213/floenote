import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SidebarTrashNoteRow } from "../src/SidebarTrashNoteRow.js";

describe("SidebarTrashNoteRow", () => {
  it("matches the note-row action pattern with Restore and Delete permanently", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarTrashNoteRow, {
        id: "0199f643-4d1e-7c9d-9ec1-bd63f086fb64",
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
    expect(markup).toContain(">Restore<");
    expect(markup).toContain(">Delete permanently<");
    expect(markup).toContain("note-row-menu-item danger");
  });
});
