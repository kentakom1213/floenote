import type { DocumentId } from "@floe-note/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_NOTE_SORT,
  deriveVisibleNotes,
  normalizeNoteSortPreference,
  readNoteSortPreference,
  writeNoteSortPreference,
  type SidebarNavigationNote,
} from "../src/sidebar-navigation.js";
import { SidebarNavigationToolbar } from "../src/SidebarNavigationToolbar.js";

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
        onQueryChange: vi.fn(),
        onSearchOpenChange: vi.fn(),
        onSortChange: vi.fn(),
        onCreateDocument: vi.fn(),
      }),
    );

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-label="Search notes"');
    expect(markup).toContain('aria-label="Sort notes"');
    expect(markup).toContain('aria-label="New note"');
    expect(markup).toContain("<svg");
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
