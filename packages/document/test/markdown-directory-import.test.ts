import { describe, expect, it } from "vitest";

import {
  isMarkdownDirectoryImportPath,
  parseMarkdownDirectoryImport,
} from "../src/index.js";
import { encodeUtf8 } from "../src/utf8.js";

const IMPORTED_AT = 1_800_000_000_000;

describe("Markdown directory import core", () => {
  it("imports .md and .markdown files recursively and flattens hierarchy", () => {
    const imported = parseMarkdownDirectoryImport(
      "my-notes",
      [
        file("research/paper-b.MARKDOWN", "# B\n"),
        file("inbox.md", "# Inbox\n"),
        file("research/paper-a.Md", "# A\n"),
      ],
      IMPORTED_AT,
    );

    expect(imported).toEqual({
      name: "my-notes",
      documents: [
        {
          title: "inbox",
          body: "# Inbox\n",
          createdAt: IMPORTED_AT,
          updatedAt: IMPORTED_AT,
          tags: [],
        },
        {
          title: "paper-a",
          body: "# A\n",
          createdAt: IMPORTED_AT,
          updatedAt: IMPORTED_AT,
          tags: [],
        },
        {
          title: "paper-b",
          body: "# B\n",
          createdAt: IMPORTED_AT,
          updatedAt: IMPORTED_AT,
          tags: [],
        },
      ],
    });
  });

  it("allows duplicate titles from different directories", () => {
    const imported = parseMarkdownDirectoryImport(
      "notes",
      [
        file("work/ideas.md", "work"),
        file("personal/ideas.markdown", "personal"),
      ],
      IMPORTED_AT,
    );

    expect(imported.documents.map(({ title }) => title)).toEqual([
      "ideas",
      "ideas",
    ]);
    expect(imported.documents.map(({ body }) => body)).toEqual([
      "personal",
      "work",
    ]);
  });

  it("preserves Markdown and YAML frontmatter verbatim", () => {
    const body = "---\ntags:\n  - research\n---\n\n# Paper\n";
    const imported = parseMarkdownDirectoryImport(
      "notes",
      [file("paper.md", body)],
      IMPORTED_AT,
    );

    expect(imported.documents[0]).toEqual({
      title: "paper",
      body,
      createdAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT,
      tags: [],
    });
  });

  it("ignores hidden files and hidden directories", () => {
    const imported = parseMarkdownDirectoryImport(
      "notes",
      [
        file("visible.md", "visible"),
        file(".hidden.md", "hidden"),
        file(".obsidian/workspace.md", "obsidian"),
        file(".git/note.md", "git"),
        file("nested/.private/secret.markdown", "secret"),
        file("nested/.draft.md", "draft"),
      ],
      IMPORTED_AT,
    );

    expect(imported.documents).toHaveLength(1);
    expect(imported.documents[0]?.title).toBe("visible");
  });

  it("ignores non-Markdown files", () => {
    const imported = parseMarkdownDirectoryImport(
      "notes",
      [
        file("note.md", "note"),
        file("image.png", "not markdown"),
        file("README.txt", "not markdown"),
      ],
      IMPORTED_AT,
    );

    expect(imported.documents.map(({ title }) => title)).toEqual(["note"]);
  });

  it("falls back to Imported notes when the directory name is unavailable", () => {
    const imported = parseMarkdownDirectoryImport(
      "   ",
      [file("note.md", "body")],
      IMPORTED_AT,
    );

    expect(imported.name).toBe("Imported notes");
  });

  it("fails when no importable Markdown files exist", () => {
    expect(() =>
      parseMarkdownDirectoryImport(
        "notes",
        [
          file(".obsidian/config.md", "ignored"),
          file("image.png", "ignored"),
        ],
        IMPORTED_AT,
      ),
    ).toThrow("No Markdown files were found");
  });

  it("fails on invalid UTF-8 instead of silently skipping the file", () => {
    expect(() =>
      parseMarkdownDirectoryImport(
        "notes",
        [
          {
            relativePath: "broken.md",
            content: Uint8Array.of(0xc3, 0x28),
          },
        ],
        IMPORTED_AT,
      ),
    ).toThrow("Markdown file is not valid UTF-8: broken.md");
  });

  it("rejects absurd relative path semantics", () => {
    expect(() => isMarkdownDirectoryImportPath("../outside.md")).toThrow(
      "Invalid Markdown directory path: ../outside.md",
    );
    expect(() => isMarkdownDirectoryImportPath("/absolute.md")).toThrow(
      "Invalid Markdown directory path: /absolute.md",
    );
    expect(() => isMarkdownDirectoryImportPath("nested\\note.md")).toThrow(
      "Invalid Markdown directory path: nested\\note.md",
    );
  });

  it("rejects an invalid import timestamp", () => {
    expect(() =>
      parseMarkdownDirectoryImport(
        "notes",
        [file("note.md", "body")],
        Number.NaN,
      ),
    ).toThrow("importedAt must be a finite timestamp");
  });
});

function file(relativePath: string, body: string) {
  return {
    relativePath,
    content: encodeUtf8(body),
  };
}
