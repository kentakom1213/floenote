import { createDocumentId, type DocumentId } from "@floe-note/domain";
import { NoteDocument, NoteProject } from "@floe-note/document";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_NOTE_SORT,
  DEFAULT_TAG_FILTER_MODE,
  deriveProjectTags,
  deriveVisibleNotes,
  normalizeNoteSortPreference,
  resolveSelectedTags,
  readNoteSortPreference,
  selectNextDocumentAfterDeletion,
  writeNoteSortPreference,
  type SidebarNavigationNote,
} from "../src/sidebar-navigation.js";
import { SidebarNavigationToolbar } from "../src/SidebarNavigationToolbar.js";
import { SidebarNoteRow } from "../src/SidebarNoteRow.js";

function note(
  id: string,
  title: string,
  tags: readonly string[],
  createdAt: number,
  updatedAt: number,
): SidebarNavigationNote {
  return {
    id: id as DocumentId,
    title,
    tags,
    createdAt,
    updatedAt,
  };
}

const NOTES = [
  note("a", "Gamma", ["research"], 100, 400),
  note("b", "alpha", ["Daily", "work"], 300, 200),
  note("c", "Beta", ["Ideas"], 200, 300),
];

describe("sidebar navigation", () => {
  it("renders Search, Sort, and New note toolbar controls", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarNavigationToolbar, {
        query: "",
        searchOpen: false,
        sort: DEFAULT_NOTE_SORT,
        tags: ["graph", "research"],
        selectedTags: ["research"],
        tagFilterMode: DEFAULT_TAG_FILTER_MODE,
        onQueryChange: vi.fn(),
        onSearchOpenChange: vi.fn(),
        onSortChange: vi.fn(),
        onSelectedTagsChange: vi.fn(),
        onTagFilterModeChange: vi.fn(),
        onCreateDocument: vi.fn(),
      }),
    );

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-label="Search notes"');
    expect(markup).toContain('aria-label="Sort notes"');
    expect(markup).toContain('aria-label="Filter notes by tags"');
    expect(markup).toContain('aria-label="Tag filter mode"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('aria-label="New note"');
    expect(markup).toContain("<svg");
  });

  it("renders an extensible note row action menu with delete", () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarNoteRow, {
        id: "note-a" as DocumentId,
        title: "Research",
        selected: true,
        onSelect: vi.fn(),
        onDelete: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Actions for Research"');
    expect(markup).toContain("Delete note");
    expect(markup).toContain("note-row-menu-item danger");
    expect(markup.match(/<circle/g)).toHaveLength(3);
  });


  it("derives unique Project tags from active notes in deterministic order", () => {
    expect(
      deriveProjectTags([
        note("a", "A", ["work", "research"], 1, 1),
        note("b", "B", ["Ideas", "research", "graph"], 1, 1),
      ]),
    ).toEqual(["graph", "Ideas", "research", "work"]);
  });

  it("does not derive tags that only exist on deleted notes", () => {
    const project = NoteProject.create();
    const active = project.createDocument("Active");
    active.setTags(["research"]);
    const deleted = project.createDocument("Deleted");
    deleted.setTags(["trash-only"]);
    project.deleteDocument(deleted.id);

    const activeNotes = project.listDocuments().flatMap((summary) => {
      const document = project.getDocument(summary.id);
      return document
        ? [
            note(
              document.id,
              document.title,
              document.tags,
              document.createdAt ?? 0,
              document.updatedAt ?? 0,
            ),
          ]
        : [];
    });

    expect(deriveProjectTags(activeNotes)).toEqual(["research"]);
  });

  it("reflects local and remote tag metadata when Project tags are re-derived", () => {
    const id = createDocumentId();
    const source = NoteDocument.create(id, "Source", 100);
    const target = NoteDocument.fromSnapshot(id, source.exportSnapshot());

    source.addTag("remote");
    target.importUpdate(source.exportUpdate());

    expect(
      deriveProjectTags([
        note(
          target.id,
          target.title,
          target.tags,
          target.createdAt ?? 0,
          target.updatedAt ?? 0,
        ),
      ]),
    ).toEqual(["remote"]);

    target.addTag("local");
    expect(
      deriveProjectTags([
        note(
          target.id,
          target.title,
          target.tags,
          target.createdAt ?? 0,
          target.updatedAt ?? 0,
        ),
      ]),
    ).toEqual(["local", "remote"]);
  });

  it("filters by title", () => {
    expect(deriveVisibleNotes(NOTES, "beta", DEFAULT_NOTE_SORT).map((n) => n.id))
      .toEqual(["c"]);
  });

  it("filters by tag", () => {
    expect(deriveVisibleNotes(NOTES, "research", DEFAULT_NOTE_SORT).map((n) => n.id))
      .toEqual(["a"]);
  });

  it("filters case-insensitively", () => {
    expect(deriveVisibleNotes(NOTES, "DAILY", DEFAULT_NOTE_SORT).map((n) => n.id))
      .toEqual(["b"]);
  });


  it("filters by exact selected tag membership", () => {
    const notes = [
      note("research", "Research", ["research"], 100, 100),
      note("old", "Old", ["research-old"], 200, 200),
    ];

    expect(
      deriveVisibleNotes(notes, "", DEFAULT_NOTE_SORT, ["research"], "and").map(
        (entry) => entry.id,
      ),
    ).toEqual(["research"]);
  });

  it("supports AND across multiple selected tags", () => {
    const notes = [
      note("a", "Graph paper", ["research", "graph"], 100, 300),
      note("b", "Research log", ["research"], 200, 200),
      note("c", "Graph work", ["work", "graph"], 300, 100),
    ];

    expect(
      deriveVisibleNotes(
        notes,
        "",
        DEFAULT_NOTE_SORT,
        ["research", "graph"],
        "and",
      ).map((entry) => entry.id),
    ).toEqual(["a"]);
  });

  it("supports OR across multiple selected tags", () => {
    const notes = [
      note("a", "Graph paper", ["research", "graph"], 100, 300),
      note("b", "Research log", ["research"], 200, 200),
      note("c", "Graph work", ["work", "graph"], 300, 100),
      note("d", "Other", ["ideas"], 400, 50),
    ];

    expect(
      deriveVisibleNotes(
        notes,
        "",
        DEFAULT_NOTE_SORT,
        ["research", "graph"],
        "or",
      ).map((entry) => entry.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("combines the multi-tag filter with quick search using outer AND semantics", () => {
    const notes = [
      note("a", "Graph paper", ["research"], 100, 300),
      note("b", "Research log", ["research"], 200, 200),
      note("c", "Graph work", ["work"], 300, 100),
    ];

    expect(
      deriveVisibleNotes(
        notes,
        "graph",
        DEFAULT_NOTE_SORT,
        ["research", "work"],
        "or",
      ).map((entry) => entry.id),
    ).toEqual(["a", "c"]);
  });

  it("drops selected tags that no longer exist while preserving the rest", () => {
    expect(
      resolveSelectedTags(["research", "gone"], ["graph", "research", "work"]),
    ).toEqual(["research"]);
    expect(resolveSelectedTags(["gone"], ["work"])).toEqual([]);
    expect(resolveSelectedTags([], ["work"])).toEqual([]);
  });

  it("returns every note for an empty query", () => {
    expect(deriveVisibleNotes(NOTES, "", DEFAULT_NOTE_SORT)).toHaveLength(3);
  });

  it("sorts by updatedAt in both directions", () => {
    expect(
      deriveVisibleNotes(NOTES, "", { mode: "updated", direction: "desc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["a", "c", "b"]);
    expect(
      deriveVisibleNotes(NOTES, "", { mode: "updated", direction: "asc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["b", "c", "a"]);
  });

  it("sorts by createdAt in both directions", () => {
    expect(
      deriveVisibleNotes(NOTES, "", { mode: "created", direction: "desc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["b", "c", "a"]);
    expect(
      deriveVisibleNotes(NOTES, "", { mode: "created", direction: "asc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("sorts by title in both directions", () => {
    expect(
      deriveVisibleNotes(NOTES, "", { mode: "title", direction: "asc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["b", "c", "a"]);
    expect(
      deriveVisibleNotes(NOTES, "", { mode: "title", direction: "desc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("combines filtering and sorting", () => {
    expect(
      deriveVisibleNotes(NOTES, "a", { mode: "created", direction: "asc" }).map(
        (n) => n.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("preserves next-note selection semantics after deleting the selected note", () => {
    const before = [
      { id: "a" as DocumentId },
      { id: "b" as DocumentId },
      { id: "c" as DocumentId },
    ];

    expect(
      selectNextDocumentAfterDeletion(
        before,
        [{ id: "a" as DocumentId }, { id: "c" as DocumentId }],
        "b" as DocumentId,
      ),
    ).toBe("c");

    expect(
      selectNextDocumentAfterDeletion(
        before,
        [{ id: "a" as DocumentId }, { id: "b" as DocumentId }],
        "c" as DocumentId,
      ),
    ).toBe("b");
  });

  it("normalizes invalid stored preferences", () => {
    expect(normalizeNoteSortPreference({ mode: "manual", direction: "sideways" }))
      .toEqual(DEFAULT_NOTE_SORT);
  });

  it("stores sort as a device-local preference", () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const previousWindow = globalThis.window;
    vi.stubGlobal("window", { localStorage });

    try {
      expect(readNoteSortPreference()).toEqual(DEFAULT_NOTE_SORT);

      writeNoteSortPreference({ mode: "title", direction: "asc" });

      expect(readNoteSortPreference()).toEqual({
        mode: "title",
        direction: "asc",
      });
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "floe-note-note-sort",
        JSON.stringify({ mode: "title", direction: "asc" }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (previousWindow !== undefined) {
        vi.stubGlobal("window", previousWindow);
      }
    }
  });
});
