import { createDocumentId, createWorkspaceId, type DocumentId } from "@floe-note/domain";
import { NoteProject } from "@floe-note/document";
import { describe, expect, it, vi } from "vitest";

import {
  GlobalSearchCache,
  normalizeSearchText,
  splitSearchTerms,
} from "../src/global-search.js";
import {
  readNoteRecency,
  recordNoteOpened,
} from "../src/note-recency.js";

describe("global search", () => {
  it("normalizes NFKC, case, and whitespace-separated terms", () => {
    expect(normalizeSearchText("ＡlGo")).toBe("algo");
    expect(splitSearchTerms("  Graph   ＡLGO  ")).toEqual(["graph", "algo"]);
  });

  it("uses literal substring AND across title, tags, and body", () => {
    const project = NoteProject.create();
    const mixed = project.createDocumentWithInitialState({
      title: "Graph notes",
      body: "This algorithm is useful.",
      createdAt: 100,
      updatedAt: 400,
      tags: ["research"],
    });
    project.createDocumentWithInitialState({
      title: "Graph only",
      body: "No matching second term.",
      createdAt: 200,
      updatedAt: 300,
      tags: [],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    expect(cache.search("graph algo", new Map()).map((result) => result.id))
      .toEqual([mixed.id]);
  });

  it("returns the matching tags for tag hits", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Tagged note",
      body: "",
      createdAt: 100,
      updatedAt: 100,
      tags: ["algorithms", "comparison", "unrelated"],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    const [result] = cache.search("algo comp", new Map());

    expect(result?.id).toBe(document.id);
    expect(result?.matchedTags).toEqual(["algorithms", "comparison"]);
  });

  it("ranks title hits before tag hits before body hits", () => {
    const project = NoteProject.create();
    const title = project.createDocumentWithInitialState({
      title: "Algorithm",
      body: "",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });
    const tag = project.createDocumentWithInitialState({
      title: "Tagged",
      body: "",
      createdAt: 100,
      updatedAt: 900,
      tags: ["algorithm"],
    });
    const body = project.createDocumentWithInitialState({
      title: "Body",
      body: "algorithm",
      createdAt: 100,
      updatedAt: 1000,
      tags: [],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    expect(cache.search("algo", new Map()).map((result) => result.id))
      .toEqual([title.id, tag.id, body.id]);
  });

  it("uses updatedAt as the tie-breaker", () => {
    const project = NoteProject.create();
    const older = project.createDocumentWithInitialState({
      title: "Older",
      body: "algorithm",
      createdAt: 100,
      updatedAt: 200,
      tags: [],
    });
    const newer = project.createDocumentWithInitialState({
      title: "Newer",
      body: "algorithm",
      createdAt: 100,
      updatedAt: 300,
      tags: [],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    expect(cache.search("algo", new Map()).map((result) => result.id))
      .toEqual([newer.id, older.id]);
  });

  it("excludes deleted notes and restores them when active again", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Hidden algorithm",
      body: "",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);
    expect(cache.search("algo", new Map())).toHaveLength(1);

    project.deleteDocument(document.id);
    cache.syncProject(project);
    expect(cache.search("algo", new Map())).toHaveLength(0);

    project.restoreDocument(document.id);
    cache.syncProject(project);
    expect(cache.search("algo", new Map())).toHaveLength(1);
  });

  it("updates only the changed note cache entry when notified", () => {
    const project = NoteProject.create();
    const document = project.createDocumentWithInitialState({
      title: "Draft",
      body: "before",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);
    expect(cache.search("after", new Map())).toHaveLength(0);

    const binding = document.getEditorBinding();
    binding.getText(binding.doc).splice(0, "before".length, "after");
    binding.doc.commit();
    cache.updateDocument(document);

    expect(cache.search("after", new Map()).map((result) => result.id))
      .toEqual([document.id]);
  });

  it("uses lastOpenedAt before updatedAt for an empty query", () => {
    const project = NoteProject.create();
    const recentlyUpdated = project.createDocumentWithInitialState({
      title: "Recently updated",
      body: "",
      createdAt: 100,
      updatedAt: 900,
      tags: [],
    });
    const recentlyOpened = project.createDocumentWithInitialState({
      title: "Recently opened",
      body: "",
      createdAt: 100,
      updatedAt: 100,
      tags: [],
    });

    const cache = new GlobalSearchCache();
    cache.syncProject(project);

    const neverOpened = project.createDocumentWithInitialState({
      title: "Never opened",
      body: "",
      createdAt: 100,
      updatedAt: 2000,
      tags: [],
    });
    cache.syncProject(project);

    const recency = new Map<DocumentId, number>([
      [recentlyOpened.id, 1000],
      [recentlyUpdated.id, 500],
    ]);

    expect(cache.search("", recency).map((result) => result.id))
      .toEqual([recentlyOpened.id, recentlyUpdated.id, neverOpened.id]);
  });

  it("stores recent-open history as a device-local Workspace preference", () => {
    const values = new Map<string, string>();
    const localStorage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
      key: vi.fn((index: number) => [...values.keys()][index] ?? null),
      get length() {
        return values.size;
      },
    };
    vi.stubGlobal("window", { localStorage });

    try {
      const projectId = createWorkspaceId();
      const first = createDocumentId();
      const second = createDocumentId();

      recordNoteOpened(projectId, first, 100);
      recordNoteOpened(projectId, second, 200);

      const recency = readNoteRecency(projectId);
      expect(recency.get(first)).toBe(100);
      expect(recency.get(second)).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
