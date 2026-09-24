import { describe, expect, it } from "vitest";

import {
  readMarkdownDirectorySelection,
  type BrowserMarkdownDirectoryFile,
} from "../src/markdown-directory-reader.js";

const IMPORTED_AT = 1_800_000_000_000;

describe("browser Markdown directory reader", () => {
  it("derives the Project name from webkitRelativePath and strips the selected root", async () => {
    const imported = await readMarkdownDirectorySelection(
      [
        browserFile("paper.md", "research/paper.md", "# Paper"),
        browserFile(
          "note.markdown",
          "research/nested/note.markdown",
          "# Note",
        ),
      ],
      IMPORTED_AT,
    );

    expect(imported.name).toBe("research");
    expect(imported.documents.map(({ title }) => title)).toEqual([
      "note",
      "paper",
    ]);
  });

  it("uses Imported notes when directory-relative paths are unavailable", async () => {
    const imported = await readMarkdownDirectorySelection(
      [browserFile("note.md", "", "body")],
      IMPORTED_AT,
    );

    expect(imported.name).toBe("Imported notes");
  });

  it("does not read hidden or non-Markdown files", async () => {
    let ignoredReads = 0;
    const ignored: BrowserMarkdownDirectoryFile = {
      name: "workspace.md",
      webkitRelativePath: "notes/.obsidian/workspace.md",
      async arrayBuffer() {
        ignoredReads += 1;
        throw new Error("must not be read");
      },
    };

    const imported = await readMarkdownDirectorySelection(
      [
        ignored,
        browserFile("visible.md", "notes/visible.md", "visible"),
        browserFile("image.png", "notes/image.png", "png"),
      ],
      IMPORTED_AT,
    );

    expect(ignoredReads).toBe(0);
    expect(imported.documents.map(({ title }) => title)).toEqual(["visible"]);
  });

  it("reports an unreadable Markdown file with its relative path", async () => {
    const unreadable: BrowserMarkdownDirectoryFile = {
      name: "broken.md",
      webkitRelativePath: "notes/nested/broken.md",
      async arrayBuffer() {
        throw new Error("permission denied");
      },
    };

    await expect(
      readMarkdownDirectorySelection([unreadable], IMPORTED_AT),
    ).rejects.toThrow("Could not read Markdown file: nested/broken.md");
  });

  it("reports zero importable Markdown files before genesis", async () => {
    await expect(
      readMarkdownDirectorySelection(
        [browserFile("image.png", "notes/image.png", "png")],
        IMPORTED_AT,
      ),
    ).rejects.toThrow("No Markdown files were found");
  });
});

function browserFile(
  name: string,
  webkitRelativePath: string,
  body: string,
): BrowserMarkdownDirectoryFile {
  return {
    name,
    webkitRelativePath,
    async arrayBuffer() {
      return new TextEncoder().encode(body).buffer;
    },
  };
}
